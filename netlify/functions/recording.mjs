// Stream a call recording, gated by the shared password. Keeps customer call audio
// private (never a public URL). Two sources:
//   ?src=cr&id=<callrail_call_id>     -> CallRail (looks up the recording, follows redirect)
//   ?src=lsa&u=<attachment_url>       -> LSA (fetches the Google attachment with an OAuth token)
// Always requires &pass=<VPRC_ADS_PASSWORD>.
// Buffers the file and honors HTTP Range requests (206) so <audio> can load/seek/play
// (Safari in particular refuses media served as a plain 200 with no length/range support).
const PASS = process.env.VPRC_ADS_PASSWORD || "gunnar";
const PASS_KWS = process.env.VPRC_ADS_PASSWORD_KWS || "dan";
const VALID_TOKENS = ["v1-" + PASS, "v1-" + PASS_KWS];
const CALLRAIL_ACCT = "340673951";

function authed(request) {
  const cookies = request.headers.get("cookie") || "";
  if (cookies.split(";").some((c) => {
    const t = c.trim();
    return t.startsWith("vprc_gate=") && VALID_TOKENS.includes(t.slice(10));
  })) return true;
  const p = new URL(request.url).searchParams.get("pass") || "";
  return p === PASS || p === PASS_KWS;
}

async function googleToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  return (await r.json()).access_token;
}

export default async (request) => {
  if (!authed(request)) return new Response("Unauthorized", { status: 401 });
  const u = new URL(request.url);
  const src = u.searchParams.get("src");
  try {
    let audioUrl, headers = {};
    if (src === "cr") {
      const id = u.searchParams.get("id");
      if (!id) return new Response("missing id", { status: 400 });
      const r = await fetch(`https://api.callrail.com/v3/a/${CALLRAIL_ACCT}/calls/${id}/recording.json`, {
        headers: { Authorization: `Token token="${process.env.CALLRAIL_API_KEY}"` },
      });
      if (!r.ok) return new Response("no recording", { status: 404 });
      audioUrl = (await r.json()).url;
    } else if (src === "lsa") {
      audioUrl = u.searchParams.get("u");
      if (!audioUrl) return new Response("missing u", { status: 400 });
      headers = { Authorization: "Bearer " + (await googleToken()) };
    } else {
      return new Response("bad src", { status: 400 });
    }

    const a = await fetch(audioUrl, { headers, redirect: "follow" });
    if (!a.ok) return new Response("upstream " + a.status, { status: 502 });
    const ctype = a.headers.get("content-type") || "audio/mpeg";
    const full = Buffer.from(await a.arrayBuffer());
    const total = full.length;

    const range = request.headers.get("range");
    const base = { "Content-Type": ctype, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
    const m = range && range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      const slice = full.subarray(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(slice.length) },
      });
    }
    return new Response(full, { status: 200, headers: { ...base, "Content-Length": String(total) } });
  } catch (e) {
    return new Response("error: " + e.message, { status: 500 });
  }
};

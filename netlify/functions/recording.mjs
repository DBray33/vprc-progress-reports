// Stream a call recording, gated by the shared password. Keeps customer call audio
// private (never a public URL). Two sources:
//   ?src=cr&id=<callrail_call_id>     -> CallRail (looks up the recording, follows redirect)
//   ?src=lsa&u=<attachment_url>       -> LSA (fetches the Google attachment with an OAuth token)
// Auth: the site gate cookie (vprc_gate) or &pass=<VPRC_ADS_PASSWORD>.
//
// The browser's <audio> element sends a Range request on play/seek. We forward that Range
// header to the upstream (both CallRail storage and Google LSA support byte ranges) and
// stream the upstream body straight through - no buffering. That keeps large recordings from
// hitting the function's memory/time limits, and preserves the Content-Length / Content-Range
// headers Safari requires to actually play and seek the audio.
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
    let audioUrl, upstreamHeaders = {};
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
      upstreamHeaders.Authorization = "Bearer " + (await googleToken());
    } else {
      return new Response("bad src", { status: 400 });
    }

    // Forward the browser's Range header so the upstream returns exactly the requested
    // slice (206), then pass its body + range headers through without buffering.
    const range = request.headers.get("range");
    if (range) upstreamHeaders.Range = range;

    const a = await fetch(audioUrl, { headers: upstreamHeaders, redirect: "follow" });
    if (!a.ok && a.status !== 206) return new Response("upstream " + a.status, { status: 502 });

    const out = new Headers();
    out.set("Content-Type", a.headers.get("content-type") || "audio/mpeg");
    out.set("Accept-Ranges", "bytes");
    out.set("Cache-Control", "private, max-age=3600");
    for (const h of ["content-length", "content-range"]) {
      const v = a.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(a.body, { status: a.status, headers: out });
  } catch (e) {
    return new Response("error: " + e.message, { status: 500 });
  }
};

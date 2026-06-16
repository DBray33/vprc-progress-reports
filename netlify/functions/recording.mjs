// Stream a call recording, gated by the shared password. Keeps customer call audio
// private (never a public URL). Two sources:
//   ?src=cr&id=<callrail_call_id>     -> CallRail (looks up the recording, follows redirect)
//   ?src=lsa&u=<attachment_url>       -> LSA (fetches the Google attachment with an OAuth token)
// Always requires &pass=<VPRC_ADS_PASSWORD>.
const PASS = process.env.VPRC_ADS_PASSWORD || "gunnar";
const CALLRAIL_ACCT = "340673951";

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
  const u = new URL(request.url);
  if ((u.searchParams.get("pass") || "") !== PASS) return new Response("Unauthorized", { status: 401 });
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
    return new Response(a.body, {
      headers: {
        "Content-Type": a.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return new Response("error: " + e.message, { status: 500 });
  }
};

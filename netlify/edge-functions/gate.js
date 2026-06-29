// Site-wide password gate (Netlify Edge Function).
//
// Gates EVERY page of the reports site behind a single password before any
// HTML is served. This is a deterrent, not hardened security (Netlify's
// native password protection requires a paid plan) - but unlike a client-side
// overlay it does not ship the page content until the visitor is authenticated.
//
// Password: VPRC_ADS_PASSWORD env var (falls back to "gunnar"), shared with
// the Google Ads / LSA status page + function so it is one password for the
// whole property. Auth is remembered for 30 days via an HttpOnly cookie.

const PASS = Netlify.env.get("VPRC_ADS_PASSWORD") || "gunnar";
const PASS_KWS = Netlify.env.get("VPRC_ADS_PASSWORD_KWS") || "dan";
const COOKIE = "vprc_gate";
const USER_COOKIE = "vprc_user"; // readable by page JS; identifies who is editing
// Each password -> cookie token + display role. Tokens stay "v1-<pass>" so existing
// Valley Peak logins keep working; KWS is added alongside.
const USERS = {
  [PASS]: { token: "v1-" + PASS, role: "Valley Peak" },
  [PASS_KWS]: { token: "v1-" + PASS_KWS, role: "Dan" },
};
const VALID_TOKENS = Object.values(USERS).map((u) => u.token);
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function loginPage(next, error) {
  const safeNext = (next || "/").replace(/"/g, "%22");
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Valley Peak Roofing - Reports</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#000; color:#fff; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; padding:20px; }
  .box { background:rgba(28,28,30,0.85); border:0.5px solid rgba(255,255,255,0.12); border-radius:16px;
    padding:28px; width:340px; max-width:100%; text-align:center; }
  h2 { margin:0 0 6px; }
  p { color:rgba(235,235,245,0.6); font-size:13px; margin:0 0 16px; }
  input { width:100%; padding:11px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.18);
    background:rgba(58,58,60,0.5); color:#fff; font-size:15px; font-family:inherit; }
  button { width:100%; margin-top:12px; padding:11px 12px; border:none; border-radius:10px; cursor:pointer;
    background:linear-gradient(135deg,#0A84FF 0%,#0064D2 100%); color:#fff; font-size:15px; font-weight:600; }
  .err { color:#FF453A; font-size:12px; margin-top:10px; ${error ? "" : "display:none;"} }
</style></head>
<body>
  <div class="box">
    <h2>Valley Peak Roofing</h2>
    <p>Enter the password to view the reports.</p>
    <form method="POST" action="/__gate?next=${safeNext}">
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus />
      <button type="submit">Unlock</button>
      <div class="err">Incorrect password.</div>
    </form>
  </div>
</body></html>`;
  return new Response(body, {
    status: error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async (request, context) => {
  // TEMP (2026-06-29): password gate DISABLED so an external tool (Manus) can
  // crawl the reports + AI-visibility pages. To RE-ENABLE, delete the next line.
  return context.next();

  const url = new URL(request.url);

  // Already authenticated?
  const cookies = request.headers.get("cookie") || "";
  const authed = cookies.split(";").some((c) => {
    const t = c.trim();
    return t.startsWith(COOKIE + "=") && VALID_TOKENS.includes(t.slice(COOKIE.length + 1));
  });
  if (authed) return context.next();

  // Login submission
  if (request.method === "POST" && url.pathname === "/__gate") {
    let pass = "";
    try {
      const form = await request.formData();
      pass = String(form.get("password") || "");
    } catch {
      pass = "";
    }
    const next = url.searchParams.get("next") || "/";
    const u = USERS[pass];
    if (u) {
      const headers = new Headers({ location: next });
      headers.append(
        "set-cookie",
        `${COOKIE}=${u.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
      );
      // readable identity cookie (NOT HttpOnly) so the page can stamp edits with who made them
      headers.append(
        "set-cookie",
        `${USER_COOKIE}=${encodeURIComponent(u.role)}; Path=/; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
      );
      return new Response(null, { status: 302, headers });
    }
    return loginPage(next, true);
  }

  // Not authenticated: show the login page for the originally requested path.
  return loginPage(url.pathname + url.search, false);
};

export const config = {
  path: "/*",
  // Let the backend function (which has its own x-vprc-pass auth) and
  // Netlify internals through untouched.
  excludedPath: ["/.netlify/*"],
};

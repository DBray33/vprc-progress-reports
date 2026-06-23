// Shared server-side store for the Google Ads & LSA lead status page.
// GET  -> returns the saved state object { leadId: {status,value,name,details}, ... }
// POST -> merges the posted state into the stored state (per-lead shallow merge) and saves.
// Backed by Netlify Blobs. Same-origin, so no CORS needed.
import { getStore } from "@netlify/blobs";

const STORE = "vprc-ads-status";
const KEY = "state";
const PASS = process.env.VPRC_ADS_PASSWORD || "gunnar";
const PASS_KWS = process.env.VPRC_ADS_PASSWORD_KWS || "dan";

// The site-wide gate (netlify/edge-functions/gate.js) sets this cookie after a
// successful login. We trust it here so the page needs no password of its own.
const GATE_COOKIE = "vprc_gate";
const VALID_TOKENS = ["v1-" + PASS, "v1-" + PASS_KWS];

function isAuthorized(request) {
  const cookies = request.headers.get("cookie") || "";
  if (cookies.split(";").some((c) => {
    const t = c.trim();
    return t.startsWith(GATE_COOKIE + "=") && VALID_TOKENS.includes(t.slice(GATE_COOKIE.length + 1));
  })) return true;
  // Legacy / script fallback (e.g. server-side backups send the header).
  const h = request.headers.get("x-vprc-pass") || "";
  return h === PASS || h === PASS_KWS;
}

export default async (request, context) => {
  // Gate every read/write on the site-wide login (cookie) or legacy header.
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const store = getStore(STORE);

  if (request.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || {};
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  if (request.method === "POST") {
    let incoming;
    try {
      incoming = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const current = (await store.get(KEY, { type: "json" })) || {};
    const merged = { ...current };
    for (const [id, fields] of Object.entries(incoming || {})) {
      if (fields && typeof fields === "object") {
        merged[id] = { ...(merged[id] || {}), ...fields };
      }
    }
    await store.setJSON(KEY, merged);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

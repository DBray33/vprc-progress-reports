// Shared server-side store for the Google Ads & LSA lead status page.
// GET  -> returns the saved state object { leadId: {status,value,name,details}, ... }
// POST -> merges the posted state into the stored state (per-lead shallow merge) and saves.
// Backed by Netlify Blobs. Same-origin, so no CORS needed.
import { getStore } from "@netlify/blobs";

const STORE = "vprc-ads-status";
const KEY = "state";
const PASS = process.env.VPRC_ADS_PASSWORD || "gunnar";

export default async (request, context) => {
  // gate every read/write on the shared password
  if ((request.headers.get("x-vprc-pass") || "") !== PASS) {
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

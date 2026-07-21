// GET /api/admin-list?key=... -> all requests (pending first). Admin-key gated.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || request.headers.get("X-Admin-Key") || "";
    if (!env.ADMIN_KEY || !safeEqual(key, String(env.ADMIN_KEY))) return json({ ok: false, error: "Not authorized." }, 401);
    if (!env.DB) return json({ ok: false }, 500);
    const q = await env.DB.prepare(
      `SELECT f.id, f.title, f.body, f.status, f.created_at,
         (SELECT COUNT(*) FROM feature_votes v WHERE v.feature_id = f.id) AS votes
       FROM feature_requests f
       ORDER BY (f.status = 'pending') DESC, f.created_at DESC
       LIMIT 500`
    ).all();
    return json({ ok: true, items: q.results || [] });
  } catch (e) { return json({ ok: false }, 500); }
}
function safeEqual(a, b){ if (a.length !== b.length) return false; let d=0; for (let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i); return d===0; }
function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

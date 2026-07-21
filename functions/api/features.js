// GET /api/features — public list of APPROVED requests with vote counts.
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) return json({ ok: true, items: [] });
    const q = await env.DB.prepare(
      `SELECT f.id, f.title, f.body, f.created_at,
         (SELECT COUNT(*) FROM feature_votes v WHERE v.feature_id = f.id) AS votes
       FROM feature_requests f
       WHERE f.status = 'approved'
       ORDER BY votes DESC, f.created_at DESC
       LIMIT 200`
    ).all();
    return json({ ok: true, items: q.results || [] });
  } catch (e) {
    return json({ ok: true, items: [] });
  }
}
function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

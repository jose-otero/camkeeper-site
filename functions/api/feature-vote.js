// POST /api/feature-vote {id, voter} — one vote per anonymous voter per item.
export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false }, 400);
    const id = parseInt(data.id, 10);
    const voter = String(data.voter || "").trim().slice(0, 64);
    if (!id || !voter) return json({ ok: false, error: "Bad request." }, 400);
    if (!env.DB) return json({ ok: false }, 500);

    const f = await env.DB.prepare("SELECT status FROM feature_requests WHERE id = ?").bind(id).first();
    if (!f || f.status !== "approved") return json({ ok: false, error: "Not found." }, 404);

    const now = new Date().toISOString();
    try {
      await env.DB.prepare("INSERT INTO feature_votes (feature_id, voter, created_at) VALUES (?,?,?)").bind(id, voter, now).run();
    } catch (e) { /* duplicate (already voted) — ignore */ }

    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM feature_votes WHERE feature_id = ?").bind(id).first();
    return json({ ok: true, votes: c ? c.n : 0 });
  } catch (e) {
    return json({ ok: false }, 500);
  }
}
function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }

// /api/feature-moderate
//   GET  ?id&token          -> returns the item (for the email review page)
//   POST {id, action, token|adminKey} -> approve or delete
// Auth: the per-request token (from the owner's email) OR the admin key.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    const token = url.searchParams.get("token") || "";
    if (!id || !token || !env.DB) return json({ ok: false }, 400);
    const f = await env.DB.prepare("SELECT id, title, body, status, token FROM feature_requests WHERE id = ?").bind(id).first();
    if (!f || !safeEqual(token, String(f.token))) return json({ ok: false, error: "Not authorized." }, 401);
    return json({ ok: true, item: { id: f.id, title: f.title, body: f.body, status: f.status } });
  } catch (e) { return json({ ok: false }, 500); }
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false }, 400);
    const id = parseInt(data.id, 10);
    const action = String(data.action || "");
    if (!id || (action !== "approve" && action !== "delete")) return json({ ok: false, error: "Bad request." }, 400);
    if (!env.DB) return json({ ok: false }, 500);

    const f = await env.DB.prepare("SELECT id, token FROM feature_requests WHERE id = ?").bind(id).first();
    if (!f) return json({ ok: false, error: "Not found." }, 404);

    const okToken = data.token && safeEqual(String(data.token), String(f.token));
    const okAdmin = data.adminKey && env.ADMIN_KEY && safeEqual(String(data.adminKey), String(env.ADMIN_KEY));
    if (!okToken && !okAdmin) return json({ ok: false, error: "Not authorized." }, 401);

    if (action === "approve") {
      await env.DB.prepare("UPDATE feature_requests SET status='approved', approved_at=? WHERE id=?").bind(new Date().toISOString(), id).run();
    } else {
      await env.DB.prepare("DELETE FROM feature_votes WHERE feature_id=?").bind(id).run();
      await env.DB.prepare("DELETE FROM feature_requests WHERE id=?").bind(id).run();
    }
    return json({ ok: true, action });
  } catch (e) { return json({ ok: false }, 500); }
}

function safeEqual(a, b){ if (a.length !== b.length) return false; let d=0; for (let i=0;i<a.length;i++) d|=a.charCodeAt(i)^b.charCodeAt(i); return d===0; }
function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }

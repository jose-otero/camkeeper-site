// POST /api/feature — submit a feature request. Turnstile-gated. Stored as
// 'pending' in D1; the public board never shows it until the owner approves.
// Emails the owner a review link (Resend).
export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: "Bad request." }, 400);
    if (data.website) return json({ ok: true }); // honeypot

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, data.cfToken, request.headers.get("CF-Connecting-IP"));
      if (!ok) return json({ ok: false, error: "Verification failed. Please try again." }, 400);
    }

    const title = String(data.title || "").trim();
    const body = String(data.body || "").trim();
    if (title.length < 3) return json({ ok: false, error: "Please add a short title." }, 400);
    if (title.length > 120) return json({ ok: false, error: "Title is a bit long — keep it under 120 characters." }, 400);
    if (body.length > 2000) return json({ ok: false, error: "Description is a bit long — keep it under 2000 characters." }, 400);
    if (!env.DB) return json({ ok: false, error: "Server not configured yet." }, 500);

    const now = new Date().toISOString();
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const res = await env.DB.prepare(
      "INSERT INTO feature_requests (title, body, status, token, created_at) VALUES (?,?,?,?,?)"
    ).bind(title, body, "pending", token, now).run();
    const id = res && res.meta ? res.meta.last_row_id : null;

    if (id && env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
      try { await sendReviewEmail(env, request, id, token, title, body); } catch (e) {}
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

async function sendReviewEmail(env, request, id, token, title, body) {
  const origin = new URL(request.url).origin;
  const link = origin + "/moderate.html?id=" + id + "&token=" + token;
  const safeTitle = esc(title), safeBody = esc(body).replace(/\n/g, "<br>");
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1b19;max-width:560px;margin:0 auto;padding:20px">
<h2 style="font-family:Georgia,serif;color:#1c1b19">New feature request</h2>
<p style="color:#5f5b54;font-size:13px">Pending your review — it is NOT public until you approve it.</p>
<div style="border:1px solid #e3dfd6;border-radius:10px;padding:16px 18px;margin:14px 0">
<div style="font-weight:bold;font-size:16px">${safeTitle}</div>
<div style="color:#5f5b54;font-size:14px;margin-top:8px">${safeBody || "<em>(no description)</em>"}</div>
</div>
<a href="${link}" style="display:inline-block;background:#2f6b45;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Review &amp; approve / delete</a>
<p style="color:#8f8a80;font-size:12px;margin-top:18px">You can also manage everything from the admin page (/admin.html).</p>
</body></html>`;
  await send(env.RESEND_API_KEY, {
    from: "CamKeeper Feature Board <camkeeper@nethrx.com>",
    to: [env.NOTIFY_EMAIL],
    subject: "New feature request: " + title,
    html,
    text: "New feature request (pending):\n\n" + title + "\n\n" + body + "\n\nReview: " + link,
  });
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new URLSearchParams();
  form.append("secret", secret); form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!resp.ok) return false;
  const out = await resp.json().catch(() => null);
  return !!(out && out.success);
}
async function send(apiKey, payload) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("Resend " + resp.status);
}
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function json(obj, status = 200){ return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }

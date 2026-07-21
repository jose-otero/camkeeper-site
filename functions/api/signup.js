// Cloudflare Pages Function — POST /api/signup
// Verifies Turnstile, stores the email in D1 ("DB"), sends a branded
// confirmation to the signer and a plain alert to NOTIFY_EMAIL (Resend).

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: "Bad request." }, 400);

    if (data.website) return json({ ok: true }); // honeypot

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(
        env.TURNSTILE_SECRET_KEY, data.cfToken, request.headers.get("CF-Connecting-IP")
      );
      if (!ok) return json({ ok: false, error: "Verification failed. Please try again." }, 400);
    }

    const email = String(data.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ ok: false, error: "Please enter a valid email address." }, 400);

    if (!env.DB) return json({ ok: false, error: "Server not configured yet." }, 500);

    const now = new Date().toISOString();
    let isNew = true;
    try {
      await env.DB.prepare("INSERT INTO signups (email, created_at) VALUES (?, ?)")
        .bind(email, now).run();
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes("UNIQUE")) isNew = false;
      else throw e;
    }

    if (isNew && env.RESEND_API_KEY) {
      try { await sendConfirmation(env.RESEND_API_KEY, email); } catch (e) {}
      if (env.NOTIFY_EMAIL) {
        try { await sendAdminNotice(env.RESEND_API_KEY, env.NOTIFY_EMAIL, email, now); } catch (e) {}
      }
    }

    return json({ ok: true, already: !isNew });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!resp.ok) return false;
  const out = await resp.json().catch(() => null);
  return !!(out && out.success);
}

async function sendConfirmation(apiKey, to) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f4ef">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">You're on the CamKeeper beta list — we'll email you when a spot opens.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;margin:0;padding:0">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fffefb;border:1px solid #e3dfd6;border-radius:14px;overflow:hidden">
<tr><td style="padding:26px 34px 18px 34px;border-bottom:1px solid #eee7db">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:#1c1b19">CamKeeper<span style="color:#2f6b45">.</span></td>
<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;color:#b6893f;text-transform:uppercase">Private&nbsp;Beta</td>
</tr></table></td></tr>
<tr><td style="padding:40px 34px 6px 34px">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#2f6b45;margin-bottom:14px">You're in</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:1.12;color:#1c1b19">You're on the beta list.</div>
</td></tr>
<tr><td style="padding:18px 34px 4px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#5f5b54">
<p style="margin:0 0 16px 0">Thanks for your interest in CamKeeper — the per-car view manager iRacing doesn't have.</p>
<p style="margin:0 0 18px 0">It's still in private testing while the core is proven out on real rigs. When the next round of beta spots opens, we'll send you an <strong style="color:#1c1b19">invitation code</strong> and a <strong style="color:#1c1b19">download link</strong>.</p>
</td></tr>
<tr><td style="padding:6px 34px 6px 34px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9f0ea;border-radius:10px"><tr>
<td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#2f6b45">
<strong>What happens next</strong><br>Nothing's needed from you — just keep an eye on your inbox. We'll reach out the moment your spot is ready.
</td></tr></table></td></tr>
<tr><td style="padding:22px 34px 6px 34px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.6;color:#8f8a80">
Free, and staying free — no purchase, no account. CamKeeper runs entirely on your own PC; nothing is uploaded.
</td></tr>
<tr><td style="padding:20px 34px 30px 34px;border-top:1px solid #eee7db">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#5f5b54">— CamKeeper</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8f8a80;margin-top:2px">Per-car iRacing view profiles</div>
</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px"><tr>
<td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#a49f95;text-align:center">
CamKeeper is an independent third-party utility, not affiliated with, endorsed by, or sponsored by iRacing.com Motorsport Simulations, LLC.<br>© 2026 · CamKeeper
</td></tr></table>
</td></tr></table>
</body></html>`;

  await send(apiKey, {
    from: "CamKeeper <camkeeper@nethrx.com>",
    to: [to],
    subject: "You're on the CamKeeper beta list",
    html: html,
    text: "Thanks for your interest in CamKeeper. You're on the beta list. When the next round of beta spots opens, we'll email you an invitation code and a download link. — CamKeeper",
  });
}

async function sendAdminNotice(apiKey, adminTo, signupEmail, when) {
  await send(apiKey, {
    from: "CamKeeper Signups <camkeeper@nethrx.com>",
    to: [adminTo],
    reply_to: signupEmail,
    subject: "New beta signup: " + signupEmail,
    text: "New CamKeeper beta signup\n\nEmail: " + signupEmail + "\nWhen: " + when + "\n\nReply to this message to email them directly.",
  });
}

async function send(apiKey, payload) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("Resend " + resp.status + ": " + (await resp.text()));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

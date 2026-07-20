// Cloudflare Pages Function — POST /api/signup
// Stores a beta-signup email in D1 (binding "DB") and sends a
// confirmation email via Resend (secret "RESEND_API_KEY").

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: "Bad request." }, 400);

    // Honeypot — bots fill this hidden field; humans never do.
    if (data.website) return json({ ok: true });

    const email = String(data.email || "").trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) return json({ ok: false, error: "Please enter a valid email address." }, 400);

    if (!env.DB) return json({ ok: false, error: "Server not configured yet." }, 500);

    const now = new Date().toISOString();
    let isNew = true;
    try {
      await env.DB
        .prepare("INSERT INTO signups (email, created_at) VALUES (?, ?)")
        .bind(email, now)
        .run();
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes("UNIQUE")) isNew = false; // already signed up
      else throw e;
    }

    // Send the confirmation email — best-effort, never blocks the signup.
    if (isNew && env.RESEND_API_KEY) {
      try { await sendConfirmation(env.RESEND_API_KEY, email); } catch (e) { /* ignore */ }
    }

    return json({ ok: true, already: !isNew });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

async function sendConfirmation(apiKey, to) {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1b19;line-height:1.6">
    <p>Thanks for your interest in <strong>CamKeeper</strong>.</p>
    <p>You're on the beta list. CamKeeper is still in private testing while the core is proven out on real rigs. When the next round of beta spots opens up, we'll email you an invitation code and a download link.</p>
    <p>Nothing else is needed from you for now — just keep an eye on your inbox.</p>
    <p style="color:#5f5b54">— CamKeeper<br>Per-car iRacing view profiles</p>
    <hr style="border:none;border-top:1px solid #e3dfd6;margin:20px 0">
    <p style="font-size:12px;color:#8f8a80">CamKeeper is an independent third-party utility, not affiliated with or endorsed by iRacing.com Motorsport Simulations, LLC.</p>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CamKeeper <camkeeper@nethrx.com>",
      to: [to],
      subject: "You're on the CamKeeper beta list",
      html: html,
      text: "Thanks for your interest in CamKeeper. You're on the beta list. When the next round of beta spots opens, we'll email you an invitation code and a download link. — CamKeeper",
    }),
  });

  if (!resp.ok) throw new Error("Resend " + resp.status + ": " + (await resp.text()));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

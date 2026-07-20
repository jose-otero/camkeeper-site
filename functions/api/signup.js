// Cloudflare Pages Function — handles POST /api/signup
// Stores a beta-signup email in the D1 database bound as "DB".

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: "Bad request." }, 400);

    // Honeypot: real users never fill this hidden field. If it's filled,
    // pretend success so bots don't learn anything.
    if (data.website) return json({ ok: true });

    const email = String(data.email || "").trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) return json({ ok: false, error: "Please enter a valid email address." }, 400);

    if (!env.DB) return json({ ok: false, error: "Server not configured yet." }, 500);

    const now = new Date().toISOString();
    try {
      await env.DB
        .prepare("INSERT INTO signups (email, created_at) VALUES (?, ?)")
        .bind(email, now)
        .run();
    } catch (e) {
      const msg = String((e && e.message) || e);
      // Already signed up — treat as success.
      if (msg.includes("UNIQUE")) return json({ ok: true, already: true });
      throw e;
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

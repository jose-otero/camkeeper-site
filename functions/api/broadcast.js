// POST /api/broadcast?key=ADMIN_KEY  -> emails the "we're live" announcement to
// every signup that hasn't been notified yet. Admin-key gated.
//
//   ?key=...          required — must equal env.ADMIN_KEY
//   ?dry=1            preview only: returns how many would be emailed, sends nothing
//   ?limit=N          cap this run to N recipients (optional safety valve)
//
// Privacy: each recipient is sent an individual message (to:[oneEmail]) via the
// Resend batch API — nobody ever sees another subscriber's address.
// Idempotent: a `notified_at` timestamp is stamped per email after a successful
// send, so re-running only targets people who haven't received it yet.

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || request.headers.get("X-Admin-Key") || "";
    if (!env.ADMIN_KEY || !safeEqual(key, String(env.ADMIN_KEY)))
      return json({ ok: false, error: "Not authorized." }, 401);
    if (!env.DB) return json({ ok: false, error: "DB not configured." }, 500);

    const dry = url.searchParams.get("dry") === "1";
    const limit = Math.max(0, parseInt(url.searchParams.get("limit") || "0", 10)) || null;

    // One-time migration: add the notified_at column if it isn't there yet.
    try { await env.DB.prepare("ALTER TABLE signups ADD COLUMN notified_at TEXT").run(); } catch (e) {}

    let sql = "SELECT email FROM signups WHERE notified_at IS NULL ORDER BY created_at ASC";
    if (limit) sql += " LIMIT " + limit;
    const q = await env.DB.prepare(sql).all();
    const emails = (q.results || []).map(r => r.email).filter(Boolean);

    if (dry) return json({ ok: true, dryRun: true, pending: emails.length });
    if (!emails.length) return json({ ok: true, sent: 0, pending: 0, note: "Nobody left to email." });
    if (!env.RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not configured." }, 500);

    const subject = "CamKeeper is live — come download it";
    const text = "CamKeeper is open for beta testing. It remembers your iRacing view (FOV, driver height, shift horizon, virtual mirror FOV) per car and puts the right one back the next time you drive. It's free, and it stays free. Download: https://camkeeper.nethrx.com";

    let sent = 0;
    const now = new Date().toISOString();
    // Resend batch API accepts up to 100 messages per call.
    for (let i = 0; i < emails.length; i += 100) {
      const chunk = emails.slice(i, i + 100);
      const batch = chunk.map(to => ({
        from: "CamKeeper <camkeeper@nethrx.com>",
        to: [to],
        subject,
        html: EMAIL_HTML,
        text,
      }));
      const resp = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!resp.ok) {
        // Stop on failure; already-marked recipients won't be re-sent on retry.
        const detail = await resp.text().catch(() => "");
        return json({ ok: false, sent, error: "Resend " + resp.status + ": " + detail.slice(0, 300) }, 502);
      }
      // Mark this chunk as notified so a re-run never double-sends.
      const marks = chunk.map(to =>
        env.DB.prepare("UPDATE signups SET notified_at = ? WHERE email = ?").bind(now, to)
      );
      try { await env.DB.batch(marks); } catch (e) {}
      sent += chunk.length;
    }

    const remain = await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE notified_at IS NULL").first();
    return json({ ok: true, sent, pending: (remain && remain.n) || 0 });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

function safeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

const EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CamKeeper is open</title>
</head>
<body style="margin:0;padding:0;background:#d9d6cf;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CamKeeper open beta is live — one saved view for every car you drive. Free.</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d9d6cf;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#f6f4ef;border:1px solid #cfcabf;border-radius:12px;overflow:hidden;">

          <!-- accent bar -->
          <tr><td style="height:6px;background:#2f6b45;font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- brand -->
          <tr>
            <td style="padding:34px 40px 6px;">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;color:#1c1b19;letter-spacing:-.01em;">CamKeeper</span><span style="color:#2f6b45;font-family:Georgia,serif;font-size:30px;">.</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 22px;">
              <span style="font-family:Georgia,serif;font-style:italic;font-size:16px;color:#5f5b54;">One saved view for every car you drive.</span>
            </td>
          </tr>

          <!-- headline -->
          <tr>
            <td style="padding:0 40px;">
              <div style="font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#8f8a80;padding-bottom:8px;">Open beta · Now available</div>
              <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.25;color:#1c1b19;">It's live — come try it.</h1>
            </td>
          </tr>

          <!-- body -->
          <tr>
            <td style="padding:0 40px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15.5px;line-height:1.6;color:#3a3733;">
              <p style="margin:0 0 16px;">Hi there,</p>
              <p style="margin:0 0 16px;">Thanks for signing up. CamKeeper is officially open for beta testing, and you're among the first to get it.</p>
              <p style="margin:0 0 16px;">CamKeeper saves your iRacing view — FOV, driver height, shift horizon, and virtual mirror FOV — <strong>per car</strong>. Pick a car's profile before you race and it loads right in with your session. No more re-dialing your seat every time you switch cars.</p>
              <p style="margin:0 0 22px;">It's free, and it stays free.</p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td align="center" style="padding:4px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#2f6b45;border-radius:8px;">
                    <a href="https://camkeeper.nethrx.com" style="display:inline-block;padding:14px 34px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Download CamKeeper</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;color:#8f8a80;">
              Windows 10/11 · installs in seconds · updates itself
            </td>
          </tr>

          <!-- divider -->
          <tr><td style="padding:0 40px;"><div style="border-top:1px solid #e3dfd6;font-size:0;line-height:0;">&nbsp;</div></td></tr>

          <!-- getting started + feedback -->
          <tr>
            <td style="padding:22px 40px 6px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.6;color:#3a3733;">
              <p style="margin:0 0 10px;"><strong style="color:#1c1b19;">Getting started</strong><br>
              Open CamKeeper, dial your view in iRacing as you like it, and save it for that car. Next time, pick that car's profile before you head into a session and your view loads with it. The full walkthrough lives on the site.</p>
              <p style="margin:14px 0 0;"><strong style="color:#1c1b19;">Hit a snag or have an idea?</strong><br>
              This is a beta, so feedback is gold. Use <strong>Report a bug</strong> right inside the app, or just reply to this email — it reaches me directly.</p>
            </td>
          </tr>

          <!-- soft donation note -->
          <tr>
            <td style="padding:18px 40px 4px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;line-height:1.6;color:#5f5b54;">
              CamKeeper is free and always will be. If it saves you time and you'd like to chip in, there's a <a href="https://camkeeper.nethrx.com" style="color:#2f6b45;text-decoration:underline;">buy-me-a-coffee</a> link on the site — entirely optional, and it keeps the lights on.
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:26px 40px 30px;">
              <div style="border-top:1px solid #e3dfd6;padding-top:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8f8a80;">
                See you on track.<br>
                — The CamKeeper project<br><br>
                CamKeeper is an independent tool and is not affiliated with, endorsed by, or associated with iRacing.com Motorsport Simulations, LLC.<br>
                You're receiving this because you signed up for the CamKeeper beta at camkeeper.nethrx.com.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Cloudflare Pages Function — POST /api/bug
// Two front doors, one backend:
//   • Website form  -> proves it's human via Turnstile (data.cfToken)
//   • In-app button -> proves it's the app via a shared key (X-CamKeeper-Key)
// Either proof is accepted; then a GitHub Issue (label "bug") is opened in the
// PRIVATE repo. Bug text lands only in the private repo — never public.
//
// Required Pages env vars:
//   GH_ISSUE_TOKEN  - fine-grained PAT with Issues: Read & Write on the private repo
//   GH_ISSUE_REPO   - "jose-otero/CamKeeper"
// Optional:
//   TURNSTILE_SECRET_KEY - reuses the signup form's Turnstile (website path)
//   APP_BUG_KEY          - shared secret the app sends (in-app path)

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json().catch(() => null);
    if (!data) return json({ ok: false, error: "Bad request." }, 400);

    if (data.website) return json({ ok: true }); // honeypot

    // --- authorize: app key OR Turnstile ---
    const appKey = request.headers.get("X-CamKeeper-Key");
    const fromApp = !!(env.APP_BUG_KEY && appKey && safeEqual(appKey, env.APP_BUG_KEY));

    if (!fromApp) {
      // website path must pass Turnstile (if configured)
      if (env.TURNSTILE_SECRET_KEY) {
        const ok = await verifyTurnstile(
          env.TURNSTILE_SECRET_KEY, data.cfToken, request.headers.get("CF-Connecting-IP")
        );
        if (!ok) return json({ ok: false, error: "Verification failed. Please try again." }, 400);
      } else if (!env.APP_BUG_KEY) {
        // nothing configured to gate abuse — refuse rather than run open
        return json({ ok: false, error: "Server not configured yet." }, 500);
      } else {
        // app key is configured but this request didn't present a valid one
        return json({ ok: false, error: "Not authorized." }, 401);
      }
    }

    // --- validate description ---
    const desc = String(data.description || "").trim();
    if (desc.length < 5) return json({ ok: false, error: "Please describe the problem (a sentence or two)." }, 400);
    if (desc.length > 5000) return json({ ok: false, error: "That's a bit long — please trim it under 5000 characters." }, 400);

    // --- optional / auto-captured context ---
    const source  = fromApp ? "app" : "website";
    const version = cleanField(data.version, 40) || "unknown";
    const os      = cleanField(data.os, 80) || "unknown";
    const contact = normalizeEmail(data.contact);        // optional, reporter's own choice
    const area    = cleanField(data.area, 60);           // optional dropdown, e.g. "Applying a profile"

    if (!env.GH_ISSUE_TOKEN || !env.GH_ISSUE_REPO)
      return json({ ok: false, error: "Server not configured yet." }, 500);

    const title = "Bug: " + firstLine(desc, 70);
    const body = buildIssueBody({ desc, source, version, os, contact, area });

    const gh = await createIssue(env.GH_ISSUE_TOKEN, env.GH_ISSUE_REPO, title, body, ["bug"]);
    if (!gh.ok) return json({ ok: false, error: "Couldn't file the report. Please try again." }, 502);

    return json({ ok: true, number: gh.number });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

function buildIssueBody({ desc, source, version, os, contact, area }) {
  const lines = [];
  lines.push(desc);
  lines.push("");
  lines.push("---");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push("| Source | " + source + " |");
  lines.push("| App version | " + version + " |");
  lines.push("| OS | " + os + " |");
  if (area) lines.push("| Area | " + area + " |");
  lines.push("| Contact | " + (contact || "_not provided_") + " |");
  lines.push("");
  lines.push("_Filed automatically from the " + source + "._");
  return lines.join("\n");
}

async function createIssue(token, repo, title, body, labels) {
  try {
    const resp = await fetch("https://api.github.com/repos/" + repo + "/issues", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "CamKeeper-BugReporter",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, labels }),
    });
    if (!resp.ok) return { ok: false };
    const out = await resp.json().catch(() => null);
    return { ok: true, number: out && out.number };
  } catch (e) {
    return { ok: false };
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

function normalizeEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  if (!e) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

function cleanField(v, max) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function firstLine(text, max) {
  const line = text.split(/\r?\n/)[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// constant-time-ish compare so a valid app key can't be guessed by timing
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

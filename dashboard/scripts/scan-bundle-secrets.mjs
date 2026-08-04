// ============================================================================
// scan-bundle-secrets.mjs — fail if any secret reaches the CLIENT bundle.
// ----------------------------------------------------------------------------
//   node dashboard/scripts/scan-bundle-secrets.mjs
// Scans ONLY dashboard/.next/static (the browser bundle — server chunks may
// legitimately hold the service-role key). Works with OR without real secrets:
//   • Pattern-based: detects a Supabase *service_role* JWT (decodes the payload —
//     the anon key is role "anon" and is intentionally public, so it is ignored),
//     OpenAI keys, Airtable PATs/keys, Brevo keys, and postgres URIs with a password.
//   • Exact-match: if the real secret values are present in the environment or in
//     the repo .env, also greps for those literal values.
// Exits 1 on any hit. Never prints a matched secret value.
// ============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DASH = resolve(here, "..");
const REPO = resolve(DASH, "..");
const STATIC_DIR = join(DASH, ".next", "static");

// ── collect exact secret values (best-effort; scanner works without them) ────
function envFromDotenv() {
  const out = {};
  for (const p of [join(REPO, ".env"), join(DASH, ".env.local")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const env = { ...envFromDotenv(), ...process.env };
const exactSecrets = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL",
  "AIRTABLE_API_KEY", "OPENAI_API_KEY", "BREVO_API_KEY"]
  .map((k) => env[k]).filter((v) => v && v.length >= 12);

// ── pattern detectors ────────────────────────────────────────────────────────
function hasServiceRoleJwt(text) {
  const jwts = text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
  for (const jwt of jwts) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
      if (payload && payload.role === "service_role") return true; // anon key (role:"anon") is intentionally public
    } catch { /* not a decodable JWT */ }
  }
  return false;
}
const PATTERNS = [
  { name: "OpenAI key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "Airtable PAT", re: /\bpat[A-Za-z0-9]{14,}\.[A-Za-z0-9]{40,}\b/ },
  { name: "Airtable legacy key", re: /\bkey[A-Za-z0-9]{14}\b/ },
  { name: "Brevo key", re: /\bxkeysib-[A-Za-z0-9]{40,}/ },
  { name: "Postgres URI with password", re: /\bpostgres(ql)?:\/\/[^\s'"]+:[^\s'"@]+@/ },
];

function scanText(text) {
  const hits = [];
  if (hasServiceRoleJwt(text)) hits.push("Supabase service_role JWT");
  for (const p of PATTERNS) if (p.re.test(text)) hits.push(p.name);
  for (const s of exactSecrets) if (text.includes(s)) hits.push("exact secret value");
  return [...new Set(hits)];
}

function main() {
  console.log("Bundle secret scan — dashboard/.next/static\n");
  if (!existsSync(STATIC_DIR)) {
    console.log("  ✗ .next/static not found — run the dashboard build first.");
    process.exit(1);
  }
  let scanned = 0;
  const leaks = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(js|mjs|json|css|map|txt|html)$/.test(f)) {
        scanned++;
        const hits = scanText(readFileSync(p, "utf8"));
        if (hits.length) leaks.push({ file: p.replace(REPO + "/", ""), hits });
      }
    }
  };
  walk(STATIC_DIR);

  if (leaks.length) {
    console.log(`  ✗ SECRET(S) IN CLIENT BUNDLE (${scanned} assets scanned):`);
    for (const l of leaks) console.log(`     ${l.file} → ${l.hits.join(", ")}`);
    console.log("\n  RESULT: FAIL — a secret is exposed to the browser. (values not printed)");
    process.exit(1);
  }
  console.log(`  ✓ no service-role JWT / API keys / DB URIs in ${scanned} client assets`);
  console.log(`  ${exactSecrets.length ? `(also exact-matched ${exactSecrets.length} known secret value(s))` : "(pattern-only — no real secrets present)"}`);
  console.log("\n  RESULT: PASS");
}
main();

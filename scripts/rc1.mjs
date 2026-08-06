// ============================================================================
// rc1.mjs — AI OLLY RC1 quality gate. THE single verification pipeline.
// ----------------------------------------------------------------------------
//   npm run rc1            run the full gate (static + integration)
//   npm run rc1 -- --static  static stages only (no secrets / DB needed)
//   npm run rc1 -- --list    print the stage plan and exit
//
// CI (.github/workflows/rc1.yml) runs EXACTLY this, so local == CI.
// Static stages always run. Integration stages (verify-*/audit-*/backend steps)
// require Supabase/Airtable secrets in a repo .env; when absent they SKIP with a
// clear reason and DO NOT fail the gate. Migration stages additionally require the
// local export/normalize artifacts. Fails (exit 1) if any *run* stage fails.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const DASH = join(REPO, "dashboard");
const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
const LIST = argv.includes("--list");

// ── environment detection (scripts read repo .env; CI writes it from secrets) ─
function envFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const dotenv = envFile(join(REPO, ".env"));
const val = (k) => process.env[k] || dotenv[k];
const HAS_DB = !!(val("SUPABASE_DB_URL") && val("SUPABASE_SERVICE_ROLE_KEY"));
const HAS_AIRTABLE = !!val("AIRTABLE_API_KEY");
const HAS_MIGRATION_ARTIFACTS = existsSync(join(REPO, "migration/antique-split/manifests/export-manifest.json"))
  && existsSync(join(REPO, "migration/antique-split/normalized/tokens.local.json"));
const eslintConfigured = ["dashboard/.eslintrc.json", "dashboard/.eslintrc.js", "dashboard/.eslintrc",
  "dashboard/eslint.config.js", "dashboard/eslint.config.mjs"].some((p) => existsSync(join(REPO, p)));

// ── stage plan ────────────────────────────────────────────────────────────────
// kind: static | integration.  gate(): true=run, or a string=skip-reason.
const npmRun = (script, cwd) => ({ cmd: "npm", args: ["run", script, "--silent"], cwd });
const node = (script, cwd = REPO) => ({ cmd: "node", args: [script], cwd });

const STAGES = [
  // ── static (always) ──
  { name: "typecheck", kind: "static", ...npmRun("typecheck", DASH) },
  { name: "lint", kind: "static", gate: () => (eslintConfigured ? true : "ESLint not configured (next.config: ignoreDuringBuilds) — no lint rules to enforce"),
    ...({ cmd: "npx", args: ["--yes", "next", "lint"], cwd: DASH }) },
  { name: "build", kind: "static", ...npmRun("build", DASH), buildEnv: true },
  { name: "bundle-secret-scan", kind: "static", ...node("dashboard/scripts/scan-bundle-secrets.mjs") },
  { name: "migration-consistency", kind: "static", ...node("scripts/check-migrations.mjs") },

  // ── integration: dashboard verify ──
  ...["content", "ai", "reception", "assets", "newsletter", "analytics", "platform-destinations", "platform-pois", "platform-routes", "platform-whispers", "platform-events", "platform-live-feed", "platform-ai-knowledge", "platform-media"].map((m) => ({
    name: `verify:${m}`, kind: "integration", need: "db", ...npmRun(`verify:${m}`, DASH),
  })),
  { name: "verify:migration", kind: "integration", need: "migration", ...npmRun("verify:migration", DASH) },

  // ── integration: dashboard security audits ──
  ...[["security", "content"], ["security-ai", "ai"], ["security-reception", "reception"],
      ["security-assets", "assets"], ["security-newsletter", "newsletter"], ["security-analytics", "analytics"],
      ["security-platform-destinations", "platform-destinations"], ["security-platform-pois", "platform-pois"], ["security-platform-routes", "platform-routes"], ["security-platform-whispers", "platform-whispers"], ["security-platform-events", "platform-events"], ["security-platform-live-feed", "platform-live-feed"], ["security-platform-ai-knowledge", "platform-ai-knowledge"], ["security-platform-media", "platform-media"]]
    .map(([s]) => ({ name: `audit:${s}`, kind: "integration", need: "db", ...npmRun(`audit:${s}`, DASH) })),
  { name: "audit:security-migration", kind: "integration", need: "migration", ...npmRun("audit:security-migration", DASH) },

  // ── integration: backend Supabase suites (Step 1-4, Package A/B/C) ──
  ...[["step1", "Step 1"], ["step2", "Step 2"], ["step3", "Step 3"], ["step4", "Step 4"],
      ["step567", "Package A"], ["packageb", "Package B"], ["packagec", "Package C"]]
    .map(([s, label]) => ({ name: `backend:${label}`, kind: "integration", need: "db", ...npmRun(`verify:supabase:${s}`, REPO) })),
];

function gateReason(st) {
  if (typeof st.gate === "function") { const g = st.gate(); if (g !== true) return g; }
  if (st.kind === "integration") {
    if (STATIC_ONLY) return "--static (integration disabled)";
    if (st.need === "db" && !HAS_DB) return "no Supabase secrets (SUPABASE_DB_URL / SERVICE_ROLE_KEY)";
    if (st.need === "migration" && !HAS_DB) return "no Supabase secrets";
    if (st.need === "migration" && !HAS_MIGRATION_ARTIFACTS) return "migration artifacts absent (run export+normalize locally)";
  }
  return null; // run
}

if (LIST) {
  console.log("RC1 pipeline stages:\n");
  for (const st of STAGES) { const r = gateReason(st); console.log(`  [${st.kind === "static" ? "S" : "I"}] ${st.name.padEnd(26)} ${r ? "SKIP — " + r : "run"}`); }
  console.log(`\n  secrets: db=${HAS_DB} airtable=${HAS_AIRTABLE} migrationArtifacts=${HAS_MIGRATION_ARTIFACTS}`);
  process.exit(0);
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`AI OLLY — RC1 quality gate ${STATIC_ONLY ? "(static only)" : ""}`);
console.log(`  secrets present: db=${HAS_DB} airtable=${HAS_AIRTABLE} migration-artifacts=${HAS_MIGRATION_ARTIFACTS}\n`);
const results = [];
const t0 = Date.now();

for (const st of STAGES) {
  const reason = gateReason(st);
  if (reason) { results.push({ name: st.name, status: "SKIP", reason, ms: 0 }); console.log(`  ⏭  ${st.name} — SKIP (${reason})`); continue; }
  const started = Date.now();
  process.stdout.write(`  ▶  ${st.name} … `);
  try {
    const env = { ...process.env };
    if (st.buildEnv) { // build never needs real secrets; supply safe placeholders if missing
      env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || val("NEXT_PUBLIC_SUPABASE_URL") || "https://placeholder.supabase.co";
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || val("NEXT_PUBLIC_SUPABASE_ANON_KEY") || "placeholder-anon-key";
    }
    execFileSync(st.cmd, st.args, { cwd: st.cwd, env, stdio: "pipe", timeout: 600000 });
    const ms = Date.now() - started;
    results.push({ name: st.name, status: "PASS", ms });
    console.log(`PASS (${(ms / 1000).toFixed(1)}s)`);
  } catch (e) {
    const ms = Date.now() - started;
    results.push({ name: st.name, status: "FAIL", ms, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || e.message || "") });
    console.log(`FAIL (${(ms / 1000).toFixed(1)}s)`);
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
const byName = new Map(STAGES.map((s) => [s.name, s.kind]));
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "SKIP");
const integrationSkipped = skipped.filter((r) => byName.get(r.name) === "integration").length;
console.log(`\n${"─".repeat(60)}`);
console.log(`  RC1 GATE: ${pass} passed · ${fail.length} failed · ${skipped.length} skipped · ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
if (fail.length) {
  console.log("\n  FAILED STAGES:");
  for (const f of fail) { console.log(`  ── ${f.name} ──`); console.log(f.out.split("\n").slice(-25).map((l) => "     " + l).join("\n")); }
  console.log("\n  RESULT: ❌ FAIL");
  process.exit(1);
}
const note = integrationSkipped ? ` (${integrationSkipped} integration stage(s) skipped — no secrets/artifacts)` : (skipped.length ? " (lint not configured)" : "");
console.log(`  RESULT: ✅ PASS${note}`);
process.exit(0);

// ============================================================================
// check-migrations.mjs — assert the Supabase migration set is consistent.
// ----------------------------------------------------------------------------
//   node scripts/check-migrations.mjs
// Fails if any migration filename is malformed, timestamps collide, ordering is
// not strictly chronological, or a file is empty. Forward-only, additive history
// is the invariant this gate protects. No DB connection; pure filesystem check.
// ============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, "..", "supabase", "migrations");
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

let fail = 0;
const bad = (m) => { fail++; console.log("  ✗", m); };

function main() {
  console.log("Migration consistency check — supabase/migrations\n");
  if (!existsSync(DIR)) { bad("supabase/migrations directory missing"); process.exit(1); }
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) { bad("no migrations found"); process.exit(1); }

  const stamps = [];
  for (const f of files) {
    const m = NAME.exec(f);
    if (!m) { bad(`malformed filename: ${f} (expected <14-digit-timestamp>_snake_name.sql)`); continue; }
    stamps.push({ f, ts: m[1] });
    if (statSync(join(DIR, f)).size === 0) bad(`empty migration: ${f}`);
  }

  // unique timestamps
  const seen = new Map();
  for (const { f, ts } of stamps) {
    if (seen.has(ts)) bad(`duplicate timestamp ${ts}: ${seen.get(ts)} & ${f}`);
    else seen.set(ts, f);
  }
  // strictly chronological in sorted (filesystem) order
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i].ts <= stamps[i - 1].ts) bad(`non-monotonic order: ${stamps[i - 1].f} then ${stamps[i].f}`);
  }

  if (fail) { console.log(`\n  RESULT: FAIL (${fail} issue(s)) across ${files.length} migrations`); process.exit(1); }
  console.log(`  ✓ ${files.length} migrations — names valid, timestamps unique + strictly ordered, none empty`);
  console.log("\n  RESULT: PASS");
}
main();

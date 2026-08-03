// ============================================================================
// POST /api/migration/run — DEV-only. Executes a single migration script
// server-side on behalf of a platform_admin. Airtable/service-role credentials
// stay in the spawned process (repo .env); only redacted logs return to the browser.
//   body: { action: "export" | "normalize" | "dry-run" | "import" | "compare" | "reset" }
// ============================================================================

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { requirePlatformAdmin, assertDevRef, repoRoot, scriptFor, redactLog } from "@/server/migration/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const run = promisify(execFile);

// Every action maps to a fixed script + fixed args. No user input reaches argv.
const ACTIONS: Record<string, { script: string; args: string[]; label: string }> = {
  export:    { script: "export-airtable-antique.mjs",    args: [],          label: "Refresh source snapshot (read-only Airtable)" },
  normalize: { script: "normalize-antique.mjs",          args: [],          label: "Dry-run normalization" },
  "dry-run": { script: "import-antique-to-supabase.mjs", args: [],          label: "Import dry-run (rolled back)" },
  import:    { script: "import-antique-to-supabase.mjs", args: ["--apply"], label: "Import to DEV" },
  compare:   { script: "compare-antique-providers.mjs",  args: [],          label: "Run comparison" },
  reset:     { script: "rollback-antique-dev-import.mjs", args: ["--apply"], label: "Reset Antique DEV import" },
};

export async function POST(req: Request) {
  try {
    assertDevRef();
    const caller = await requirePlatformAdmin(req);
    let body: any; try { body = await req.json(); } catch { body = {}; }
    const spec = ACTIONS[body?.action];
    if (!spec) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

    const script = scriptFor(spec.script);
    if (!existsSync(script)) return NextResponse.json({ error: "Migration script not available in this deployment." }, { status: 501 });

    const started = Date.now();
    let out = "", code = 0;
    try {
      const r = await run("node", [script, ...spec.args], { cwd: repoRoot(), timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
      out = r.stdout + r.stderr;
    } catch (e: any) {
      code = e.code ?? 1; out = (e.stdout ?? "") + (e.stderr ?? e.message ?? "");
    }
    return NextResponse.json({
      action: body.action, label: spec.label, ok: code === 0, durationMs: Date.now() - started,
      by: caller.email, log: redactLog(out),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

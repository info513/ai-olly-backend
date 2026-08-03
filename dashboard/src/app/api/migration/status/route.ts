// ============================================================================
// GET /api/migration/status — DEV-only migration status for the platform_admin
// workspace. Reads the local manifest/report artifacts server-side and returns
// counts + statuses. No Airtable/service-role/DB credentials ever reach the browser.
// ============================================================================

import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { requirePlatformAdmin, assertDevRef, migrationDir } from "@/server/migration/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

export async function GET(req: Request) {
  try {
    const { ref } = assertDevRef();
    await requirePlatformAdmin(req);
    const dir = migrationDir();
    const exportMan = read(join(dir, "manifests", "export-manifest.json"));
    const normSum = read(join(dir, "manifests", "normalize-summary.json"));
    const idMap = read(join(dir, "manifests", "legacy-id-map.json"));
    const compare = read(join(dir, "reports", "compare-report.json"));

    // export counts (source), excluding token/PII detail
    const source = exportMan?.tables?.filter((t: any) => !t.pii).map((t: any) => ({ name: t.name, total: t.totalRecords, antique: t.antiqueSplitRecords })) ?? [];
    const piiCountOnly = exportMan?.tables?.filter((t: any) => t.pii).map((t: any) => ({ name: t.name, total: t.totalRecords })) ?? [];

    const domains = compare?.domains ?? null;
    const compareStatus = domains
      ? (Object.values(domains).every((d: any) => d.status === "MATCH") ? "ALL MATCH" : "DIFFERENCES")
      : "not run";

    return NextResponse.json({
      devOnly: true, ref,
      snapshot: { exportedAt: exportMan?.exportedAt ?? null, tables: source.length, source, piiCountOnly },
      normalized: normSum?.counts ?? null,
      aiClassification: normSum?.ai_classification ?? null,
      imported: idMap ? { importedAt: idMap.importedAt, importVersion: idMap.importVersion, tables: Object.fromEntries(Object.entries(idMap.map).map(([k, v]: any) => [k, Object.keys(v).length])) } : null,
      compare: domains ? { status: compareStatus, domains, rooms: compare.roomMatrix?.length ?? 0, tokenSafety: compare.tokenSafety?.result ?? null, service: compare.tallies?.service ?? null } : { status: compareStatus },
      mediaPending: normSum ? 0 : null,
      warnings: buildWarnings(compare, normSum),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

function buildWarnings(compare: any, normSum: any): string[] {
  const w: string[] = [];
  if (normSum?.counts?.price_items) w.push(`${normSum.counts.price_items} price items imported with VAT/validity flagged for manual review.`);
  if (compare?.serviceComparison) {
    const t = compare.serviceComparison.filter((s: any) => s.classification === "TRANSFORMED").length;
    if (t) w.push(`${t} key facts migrated inside a broader service body (intentional structural transform).`);
  }
  w.push("City services (SERVICES Out), Split Today feed, and route→POI graph are DEFERRED — see discovery doc.");
  return w;
}

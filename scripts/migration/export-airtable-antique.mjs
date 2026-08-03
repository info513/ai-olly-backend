// ============================================================================
// export-airtable-antique.mjs — READ-ONLY Airtable → migration/antique-split/raw/
// ----------------------------------------------------------------------------
// Produces a repeatable, deterministic source snapshot of the Antique Split base.
//   • Airtable is GET-only (airtableGet); this script cannot mutate production.
//   • Content tables → full raw JSON (record IDs, field names, links, attachment
//     metadata). raw/ is gitignored (holds room access tokens + production content).
//   • PII/guest tables → COUNT ONLY. Row content is discarded in-memory, never written.
//   • UNANSWERED_QUESTIONS → non-PII fields only (question/intent/reason/status/lang).
//   • Writes manifests/export-manifest.json with per-table counts + checksums.
//
//   node scripts/migration/export-airtable-antique.mjs
// ============================================================================

import { join } from "node:path";
import {
  BASE_ID, TABLES, HOTEL_SLUG, RAW_DIR, MANIFEST_DIR, ensureDirs, writeJson,
  airtableListAll, nowIso,
} from "./_lib.mjs";

const ARG_TS = process.argv.find((a) => a.startsWith("--ts="))?.slice(5);

/** Best-effort tenant slug for a row from any hotel-slug-ish field. */
function rowSlug(fields, slugField) {
  const candidates = [slugField, "Hotel Slug (text)", "Hotel Slug", "HotelSlug", "Slug"].filter(Boolean);
  for (const f of candidates) {
    const v = fields[f];
    if (v == null) continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

// Non-PII columns retained from UNANSWERED_QUESTIONS for AI classification.
const UNANSWERED_KEEP = ["Question", "Detected Intent", "Reason", "Status", "Priority", "Language"];

async function main() {
  ensureDirs();
  const exportedAt = nowIso(ARG_TS);
  console.log(`Antique Split export — READ-ONLY — ${exportedAt}\n`);
  const manifest = { exportedAt, baseId: BASE_ID, hotelSlug: HOTEL_SLUG, importVersionTarget: "antique-v1", tables: [] };

  for (const t of TABLES) {
    let records;
    try {
      records = await airtableListAll(BASE_ID, t.id);
    } catch (e) {
      console.log(`  ✗ ${t.name}: ${e.message}`);
      manifest.tables.push({ key: t.key, name: t.name, id: t.id, error: e.message });
      continue;
    }

    // scope tally
    let antique = 0, other = 0, noSlug = 0;
    for (const r of records) {
      const slug = rowSlug(r.fields ?? {}, t.slugField);
      if (slug === HOTEL_SLUG) antique++;
      else if (slug) other++;
      else noSlug++;
    }

    const entry = {
      key: t.key, name: t.name, id: t.id, pii: !!t.pii, hasToken: !!t.hasToken,
      totalRecords: records.length, antiqueSplitRecords: antique, otherScopeRecords: other, unscopedRecords: noSlug,
    };

    if (t.pii) {
      // COUNT ONLY — never write PII row content to disk.
      entry.contentExported = false;
      entry.note = "PII/guest table — count only; row content intentionally NOT written to disk.";
      console.log(`  • ${t.name}: ${records.length} rows (antique=${antique}) — COUNT ONLY (PII)`);
    } else {
      // Full raw (content tables). For UNANSWERED keep only non-PII fields.
      const rows = records.map((r) => {
        let fields = r.fields ?? {};
        if (t.aiContentOnly) fields = Object.fromEntries(UNANSWERED_KEEP.filter((k) => k in fields).map((k) => [k, fields[k]]));
        return { id: r.id, createdTime: r.createdTime, _scope: rowSlug(r.fields ?? {}, t.slugField), fields };
      }).sort((a, b) => a.id.localeCompare(b.id));
      const checksum = writeJson(join(RAW_DIR, `${t.key}.json`), { table: t.name, id: t.id, exportedAt, records: rows });
      entry.contentExported = true;
      entry.checksum = checksum;
      entry.file = `raw/${t.key}.json`;
      console.log(`  ✓ ${t.name}: ${records.length} rows (antique=${antique}, other=${other}, unscoped=${noSlug})${t.hasToken ? " [tokens in raw only]" : ""}`);
    }
    manifest.tables.push(entry);
  }

  const mchk = writeJson(join(MANIFEST_DIR, "export-manifest.json"), manifest);
  console.log(`\n  Manifest: migration/antique-split/manifests/export-manifest.json (sha256 ${mchk.slice(0, 12)}…)`);
  console.log("  raw/ is gitignored. No Airtable writes performed. No tokens/PII in manifest.");
}
main().catch((e) => { console.error("export error:", e.message); process.exit(1); });

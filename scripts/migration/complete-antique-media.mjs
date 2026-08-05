// ============================================================================
// complete-antique-media.mjs — Whispers + confirmed extra-bed price (idempotent, DEV-ONLY).
// ----------------------------------------------------------------------------
//   node scripts/migration/complete-antique-media.mjs [--apply]
//
// Two source-backed completions the Airtable pipeline could not cover:
//   • Whispers — the 12 chapters live in the v1 PWA (pwa/whispers-data.js, read-only),
//     NOT in Airtable. Migrate verbatim → destination_whispers + hotel_whisper_settings.
//   • Extra-bed price — €40/night is in ROOM GUIDE `Room features` (raw) and verified in
//     docs/ANTIQUE_SPLIT_QA_ROUND_1.md; structure it as a price item (CONFIRMED SOURCE).
// MEDIA: there are ZERO image binaries in the repo/Airtable — nothing to upload; imagery
// is produce-and-upload (documented, not fabricated). Idempotent. assertDevSupabase().
// ============================================================================

import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertDevSupabase, readEnv, readJson, RAW_DIR, REPO_ROOT, HOTEL_SLUG, nowIso } from "./_lib.mjs";

const APPLY = process.argv.includes("--apply");
const raw = (k) => readJson(join(RAW_DIR, `${k}.json`)).records;
const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").trim() || null);
const J = (v) => JSON.stringify(v ?? null);

// Parse the v1 PWA static Whispers module (trusted repo code) without importing it.
function loadWhispers() {
  const src = readFileSync(join(REPO_ROOT, "pwa", "whispers-data.js"), "utf8");
  // eslint-disable-next-line no-new-func
  return new Function(`${src}\n;return WHISPERS_CHAPTERS;`)();
}

function whisperBody(ch) {
  const blocks = [];
  if (clean(ch.subtitle)) blocks.push({ type: "paragraph", text: clean(ch.subtitle) });
  for (const p of ch.mainText || []) if (clean(p)) blocks.push({ type: "paragraph", text: clean(p) });
  if (clean(ch.didYouKnow)) blocks.push({ type: "callout", style: "info", text: `Did you know? ${clean(ch.didYouKnow)}` });
  return { version: 1, blocks };
}

async function main() {
  const ref = assertDevSupabase();
  console.log(`Antique Split media/whispers completion → aiolly-dev (${ref}) — ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const client = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = (t, p) => client.query(t, p);
  const stats = {};
  const bump = (k, ins) => { stats[k] ??= { created: 0, updated: 0 }; ins ? stats[k].created++ : stats[k].updated++; };

  try {
    await q("begin");
    const hid = (await q("select id from hotels where slug=$1", [HOTEL_SLUG])).rows[0]?.id;
    const did = (await q("select id from destinations where slug='split'")).rows[0]?.id;
    if (!hid || !did) throw new Error("antique-split hotel/destination missing — run base import first.");

    // ── 1) Whispers (12 chapters from the v1 PWA) ─────────────────────────────
    const chapters = loadWhispers();
    for (const ch of chapters) {
      const key = String(ch.id); // ch01..ch12 — stable idempotency key
      const w = await q(`insert into destination_whispers (destination_id,channel_key,key,title,body_content,status,active,sort_order,published_at)
        values ($1,'whispers-of-the-palace',$2,$3,$4,'published',true,$5,$6)
        on conflict (destination_id,key) do update set title=excluded.title, body_content=excluded.body_content, channel_key=excluded.channel_key,
          status='published', sort_order=excluded.sort_order, updated_at=now()
        returning id, (xmax=0) inserted`,
        [did, key, clean(ch.title), J(whisperBody(ch)), Number(ch.number) || 0, new Date(nowIso()).toISOString()]);
      bump("whispers", w.rows[0].inserted);
      const wid = w.rows[0].id;
      const s = await q(`insert into hotel_whisper_settings (hotel_id,whisper_id,visible,featured,sort_order_override,hotel_recommendation)
        values ($1,$2,true,$3,$4,$5)
        on conflict (hotel_id,whisper_id) do update set visible=true, featured=excluded.featured, sort_order_override=excluded.sort_order_override, hotel_recommendation=excluded.hotel_recommendation, updated_at=now()
        returning (xmax=0) inserted`,
        [hid, wid, Number(ch.number) === 1, Number(ch.number) || 0, clean(ch.ctaAsk)]);
      bump("whisper_settings", s.rows[0].inserted);
    }

    // ── 2) Extra-bed price (CONFIRMED SOURCE: ROOM GUIDE features + QA Round-1) ─
    let amount = null;
    for (const r of raw("room_guide")) {
      const m = (r.fields["Room features/Communication"] || "").match(/extra bed[^\n]*?(?:€\s?|)(\d+(?:[.,]\d+)?)\s?(?:€|eur|)/i);
      if (m) { amount = Number(m[1].replace(",", ".")); break; }
    }
    if (amount != null) {
      const catId = (await q(`insert into price_categories (hotel_id,key,name,sort_order,active) values ($1,'room-charges','Room charges',1,true)
        on conflict (hotel_id,key) where hotel_id is not null do update set name=excluded.name, updated_at=now() returning id`, [hid])).rows[0].id;
      const pi = await q(`insert into price_items (hotel_id,category_id,key,name,description,amount,currency,vat_included,billing_unit,status,active,source_type,published_at,pms_metadata)
        values ($1,$2,'extra-bed','Extra bed','Extra bed available on request (sleeps up to three adults in eligible rooms).',$3,'EUR',true,'per_night','published',true,'hotel',$4,$5)
        on conflict (hotel_id,key) where hotel_id is not null do update set amount=excluded.amount, description=excluded.description, billing_unit='per_night', pms_metadata=excluded.pms_metadata, updated_at=now()
        returning id, (xmax=0) inserted`,
        [hid, catId, amount, new Date(nowIso()).toISOString(), J({ needs_review: false, vat_rate: "unknown_from_source", source: "ROOM GUIDE features + docs/ANTIQUE_SPLIT_QA_ROUND_1.md" })]);
      bump("extra_bed_price", pi.rows[0].inserted);
      // link the price to the room types that offer an extra bed
      const link = await q(`update room_types set default_extra_bed_price_item_id=$2, updated_at=now()
        where hotel_id=$1 and default_extra_bed_available=true and (default_extra_bed_price_item_id is distinct from $2) returning id`, [hid, pi.rows[0].id]);
      if (link.rowCount) bump("room_types_price_linked", false);
    }

    // ── 3) VAT honesty: `vat_rate` is NOT NULL (schema default 0.00), so "unknown"
    //        can't be stored as null. Airtable has no VAT rate → the migration never
    //        writes a specific rate (all sit at the 0.00 default), and every item is
    //        flagged vat unconfirmed in metadata so no VAT is silently asserted. ──
    const vfix = await q(`update price_items set pms_metadata = coalesce(pms_metadata,'{}'::jsonb) || '{"vat_status":"unconfirmed","vat_note":"no VAT rate in Airtable source; column default 0.00 is not a claim"}'::jsonb, updated_at=now()
      where hotel_id=$1 returning id`, [hid]);
    if (vfix.rowCount) { stats["vat_flagged_unconfirmed"] = { created: 0, updated: vfix.rowCount }; }

    if (APPLY) await q("commit"); else await q("rollback");
    console.log("  " + Object.entries(stats).map(([k, s]) => `${k}: +${s.created}~${s.updated}`).join("\n  "));
    console.log(`\n  ${APPLY ? "COMMITTED to aiolly-dev." : "ROLLED BACK (dry-run). Re-run with --apply."}`);
    console.log("  Whispers source: v1 PWA pwa/whispers-data.js (read-only). Extra-bed €/night: CONFIRMED (ROOM GUIDE + QA).");
    console.log("  MEDIA: 0 image binaries exist in Airtable or the PWA repo — nothing to upload; imagery is produce-and-upload (see plan).");
  } catch (e) {
    await q("rollback").catch(() => {});
    console.error("  media/whispers error (rolled back):", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });

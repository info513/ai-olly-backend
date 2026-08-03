// ============================================================================
// AI OLLY Dashboard — DEV Analytics history seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Seeds ~30 days of synthetic DAILY aggregates (counts only, NO PII) for the
// Demo Hotel so trends and previous-period comparisons render:
// ai_quality_daily, operations_daily, newsletter_daily, content_health_daily.
// Every row is stamped with the DB's calc_version ('v1'). Idempotent upsert on
// (hotel_id, day). Synthetic only — no Antique Split / production data.
//
//   node dashboard/scripts/setup-dev-analytics.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const DAYS = 30;
const ymd = (d) => d.toISOString().slice(0, 10);
// deterministic pseudo-noise per day so re-runs are stable
const noise = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

async function main() {
  console.log("AI OLLY analytics history seed →", readEnv("SUPABASE_URL"), "\n");
  const { data: hotel } = await svc.from("hotels").select("id").eq("slug", "dash-demo-hotel").single();
  if (!hotel) throw new Error("run setup-dev-user.mjs first");
  const H = hotel.id;
  const calc_version = "v1";

  const aiq = [], ops = [], nl = [], ch = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i); const day = ymd(d);
    const trend = (DAYS - i) / DAYS; // 0..1 gentle growth

    // AI quality — questions grow over the month; ~62% deterministic, ~28% model, ~10% handoff
    const total = Math.round(18 + trend * 40 + noise(i, 1) * 10);
    const handoff = Math.round(total * (0.12 - trend * 0.04) + noise(i, 2) * 2);
    const det = Math.round((total - handoff) * 0.68);
    const model = total - handoff - det;
    const unanswered = Math.max(0, Math.round(4 - trend * 3 + noise(i, 3) * 2));
    aiq.push({ hotel_id: H, day, total_questions: total, deterministic_answers: det, model_answers: model, safe_handoffs: handoff, unanswered,
      avg_latency_ms: Math.round(900 - trend * 220 + noise(i, 4) * 80), prompt_tokens: total * 120, completion_tokens: total * 45,
      knowledge_articles_used: Math.round(4 + trend * 4), coverage_estimate: total > 0 ? Number(((total - handoff) / total).toFixed(4)) : null, calc_version });

    // Operations — request volume + resolution
    const reqTotal = Math.round(3 + noise(i, 5) * 7);
    const resolved = Math.round(reqTotal * (0.7 + noise(i, 6) * 0.25));
    ops.push({ hotel_id: H, day, requests_total: reqTotal, requests_resolved: Math.min(resolved, reqTotal), requests_open: Math.max(0, reqTotal - resolved),
      avg_ack_seconds: Math.round(600 - trend * 200 + noise(i, 7) * 180), avg_resolution_seconds: Math.round(7200 - trend * 2400 + noise(i, 8) * 1200),
      feedback_count: Math.round(noise(i, 9) * 3), avg_rating: Number((3.8 + trend * 0.8 + noise(i, 10) * 0.3).toFixed(2)),
      stays_arriving: Math.round(1 + noise(i, 11) * 3), consents_granted: Math.round(noise(i, 12) * 2), calc_version });

    // Newsletter — mostly quiet; a couple of send days
    const sendDay = i === 5 || i === 18;
    const sent = sendDay ? 2 : 0;
    nl.push({ hotel_id: H, day, subscribers_active: Math.round(2 + trend * 3), consent_active: Math.round(1 + trend * 2),
      sent, delivered: sent, opened: sendDay ? 1 : 0, clicked: sendDay ? 1 : 0, bounced: 0, unsubscribed: sendDay && i === 18 ? 1 : 0, calc_version });

    // Content health — completeness improves over time
    const pub = Math.round(6 + trend * 6), drf = Math.max(0, Math.round(5 - trend * 3 + noise(i, 13) * 2)), exp = Math.round(noise(i, 14) * 2), crit = Math.max(0, Math.round(2 - trend * 2));
    ch.push({ hotel_id: H, day, published_count: pub, draft_count: drf, archived_count: Math.round(1 + noise(i, 15) * 2), expired_count: exp, critical_pending: crit,
      unresolved_unanswered: unanswered, unused_assets: Math.max(0, Math.round(6 - trend * 3)), assets_missing_alt: Math.max(0, Math.round(2 - trend)), assets_missing_rights: Math.max(0, Math.round(2 - trend)),
      completeness_score: (pub + drf + exp + crit) > 0 ? Number((pub / (pub + drf + exp + crit)).toFixed(4)) : null, calc_version });
  }

  const up = async (table, rows) => { const r = await svc.from(table).upsert(rows, { onConflict: "hotel_id,day" }); if (r.error) throw new Error(`${table}: ${r.error.message}`); };
  await up("ai_quality_daily", aiq);
  await up("operations_daily", ops);
  await up("newsletter_daily", nl);
  await up("content_health_daily", ch);

  console.log(`  ✓ ${DAYS} days × 4 aggregates seeded (ai_quality / operations / newsletter / content_health), calc_version=${calc_version}`);
  console.log("\n  Done. Open Home / Analytics.\n");
}
main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });

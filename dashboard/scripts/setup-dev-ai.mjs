// ============================================================================
// AI OLLY Dashboard — DEV AI-Knowledge seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Seeds synthetic AI Knowledge for the Demo Hotel to demonstrate Sprint 4:
// platform / destination / hotel articles, a hotel OVERRIDE, draft / published /
// critical / expired / missing-answer articles, an alias, unanswered questions,
// an ai_config, and one ai_quality_daily aggregate. Idempotent. Reads the
// service-role key from ../../.env at runtime (never committed).
//
//   node dashboard/scripts/setup-dev-ai.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const BODY = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });
const snap = (o) => ({ source_type: o.source_type, title: o.title, key: o.key, approved_answer: o.approved_answer ?? null, body_content: o.body_content, is_critical: !!o.is_critical, active: true, available_to_ai: o.available_to_ai ?? true, priority: o.priority ?? 0, category_id: o.category_id ?? null, valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null, published_at: new Date().toISOString() });

async function get(table, match) { let q = svc.from(table).select("id"); for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v); const r = await q.maybeSingle(); return r.data?.id ?? null; }
async function upsert(table, match, row) { const id = await get(table, match); if (id) { await svc.from(table).update(row).eq("id", id); return id; } const r = await svc.from(table).insert({ ...match, ...row }).select("id").single(); if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.data.id; }

async function main() {
  console.log("AI OLLY AI seed →", readEnv("SUPABASE_URL"), "\n");
  const demo = await get("hotels", { slug: "dash-demo-hotel" }); if (!demo) throw new Error("run setup-dev-user.mjs first");
  const destId = (await svc.from("hotels").select("destination_id").eq("id", demo).single()).data.destination_id;

  // categories: platform default + hotel-owned
  const pcat = await upsert("knowledge_categories", { hotel_id: null, key: "kb-policies" }, { name: "Policies", sort_order: 10, active: true });
  await upsert("knowledge_categories", { hotel_id: demo, key: "kb-hotel" }, { name: "Hotel Info", sort_order: 20, active: true });

  // platform article (canonical) + hotel OVERRIDE (same key+locale)
  const plat = await upsert("knowledge_articles", { hotel_id: null, destination_id: null, key: "check-in-policy", locale: "en" }, { category_id: pcat, title: "Check-in Policy", body_content: BODY("Standard check-in from 15:00."), approved_answer: "Check-in is from 15:00.", status: "published", active: true, available_to_ai: true, is_critical: false, published_at: new Date().toISOString(), published_snapshot: snap({ source_type: "platform", title: "Check-in Policy", key: "check-in-policy", approved_answer: "Check-in is from 15:00.", body_content: BODY("Standard check-in from 15:00."), category_id: pcat }) });
  await upsert("knowledge_articles", { hotel_id: demo, key: "check-in-policy", locale: "en" }, { category_id: pcat, title: "Check-in Policy (Demo Hotel)", body_content: BODY("Demo Hotel check-in from 14:00."), approved_answer: "Check-in is from 14:00.", status: "published", active: true, available_to_ai: true, override_of_article_id: plat, published_at: new Date().toISOString(), published_snapshot: snap({ source_type: "override", title: "Check-in Policy (Demo Hotel)", key: "check-in-policy", approved_answer: "Check-in is from 14:00.", body_content: BODY("Demo Hotel check-in from 14:00."), category_id: pcat }) });

  // destination article
  await upsert("knowledge_articles", { hotel_id: null, destination_id: destId, key: "local-tips", locale: "en" }, { category_id: pcat, title: "Local Tips", body_content: BODY("Ask reception for the best coffee spots."), approved_answer: "Ask reception for local tips.", status: "published", active: true, available_to_ai: true, published_at: new Date().toISOString(), published_snapshot: snap({ source_type: "destination", title: "Local Tips", key: "local-tips", approved_answer: "Ask reception for local tips.", body_content: BODY("Ask reception for the best coffee spots."), category_id: pcat }) });

  // hotel articles: wifi (published), emergency (critical published), spa (draft),
  // summer-promo (expired), parking (published, NO approved answer)
  const wifi = await upsert("knowledge_articles", { hotel_id: demo, key: "wifi", locale: "en" }, { title: "Wi-Fi Access", body_content: BODY("Network AIOLLY-DEMO, password at reception."), approved_answer: "Network AIOLLY-DEMO; ask reception for the password.", status: "published", active: true, available_to_ai: true, published_at: new Date().toISOString(), published_snapshot: snap({ source_type: "hotel", title: "Wi-Fi Access", key: "wifi", approved_answer: "Network AIOLLY-DEMO; ask reception for the password.", body_content: BODY("Network AIOLLY-DEMO, password at reception.") }) });
  await upsert("knowledge_articles", { hotel_id: demo, key: "emergency", locale: "en" }, { title: "Emergency Information", body_content: BODY("Dial 112 for emergencies; reception is staffed 24/7."), approved_answer: "Dial 112. Reception is staffed 24/7.", status: "published", active: true, available_to_ai: true, is_critical: true, priority: 100, published_at: new Date().toISOString(), last_critical_ack_at: new Date().toISOString(), published_snapshot: snap({ source_type: "hotel", title: "Emergency Information", key: "emergency", approved_answer: "Dial 112. Reception is staffed 24/7.", body_content: BODY("Dial 112 for emergencies; reception is staffed 24/7."), is_critical: true, priority: 100 }) });
  await upsert("knowledge_articles", { hotel_id: demo, key: "spa-info", locale: "en" }, { title: "Spa & Wellness (draft)", body_content: BODY("Draft — spa hours to be confirmed."), approved_answer: "Spa hours to be confirmed.", status: "draft", active: true, available_to_ai: true });
  await upsert("knowledge_articles", { hotel_id: demo, key: "summer-promo", locale: "en" }, { title: "Summer Promo (expired)", body_content: BODY("Summer discount ended."), approved_answer: "Summer promo has ended.", status: "published", active: true, available_to_ai: true, valid_to: new Date(Date.now() - 5 * 864e5).toISOString(), published_at: new Date(Date.now() - 30 * 864e5).toISOString(), published_snapshot: snap({ source_type: "hotel", title: "Summer Promo (expired)", key: "summer-promo", approved_answer: "Summer promo has ended.", body_content: BODY("Summer discount ended."), valid_to: new Date(Date.now() - 5 * 864e5).toISOString() }) });
  await upsert("knowledge_articles", { hotel_id: demo, key: "parking", locale: "en" }, { title: "Parking", body_content: BODY("Public garage 200m away."), approved_answer: null, status: "published", active: true, available_to_ai: true, published_at: new Date().toISOString(), published_snapshot: snap({ source_type: "hotel", title: "Parking", key: "parking", approved_answer: null, body_content: BODY("Public garage 200m away.") }) });

  // alias (hotel) -> wifi
  await upsert("knowledge_aliases", { hotel_id: demo, article_id: wifi, locale: "en", alias_text: "wifi password" }, { active: true });

  // unanswered questions
  for (const [k, cnt] of [["do you have a gluten free menu", 6], ["is there a gym", 3], ["can i bring my dog", 2]])
    await upsert("unanswered_questions", { hotel_id: demo, normalized_question: k }, { original_question: k.charAt(0).toUpperCase() + k.slice(1) + "?", occurrence_count: cnt, status: "open", last_seen_at: new Date().toISOString() });

  // ai_config (hotel, published)
  await upsert("ai_configs", { hotel_id: demo }, { tone: "warm and concise", safe_handoff_text: "Let me connect you with our reception team — they’ll be glad to help.", persona: { name: "Dioclea" }, retrieval_limit: 8, feature_flags: { suggest_pois: true }, status: "published", active: true, published_at: new Date().toISOString() });

  // ai_quality_daily aggregate (today) — composite PK (hotel_id, day)
  const day = new Date().toISOString().slice(0, 10);
  await svc.from("ai_quality_daily").upsert({ hotel_id: demo, day, total_questions: 42, deterministic_answers: 24, model_answers: 15, safe_handoffs: 3, unanswered: 3, avg_latency_ms: 780, prompt_tokens: 9000, completion_tokens: 3200, knowledge_articles_used: 7, coverage_estimate: 0.9286, calc_version: "v1" }, { onConflict: "hotel_id,day" });

  console.log("  ✓ categories, articles (platform/dest/hotel/override/draft/critical/expired/no-answer), alias, 3 unanswered, ai_config, ai_quality_daily");
  console.log("\n  Done. Open AI → Knowledge / Preview / Quality / Unanswered / Configuration.\n");
}
main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });

// ============================================================================
// AI OLLY Dashboard — AI module REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the AI Knowledge module the way the dashboard does — anon key +
// per-user JWT, RLS-enforced — across roles and tenants. Real Auth users;
// cleaned up. Covers knowledge inheritance/override/dedup, destination scope,
// draft-in-preview-only, expired/AI-hidden exclusion, the Draft/Live separation
// (publish/rollback/versions/critical-ack), permissions (canonical protection,
// editor is_critical guard), aliases, unanswered, and cross-tenant denial.
// Reads the service-role key from ../../.env at runtime.
//
//   node dashboard/scripts/verify-ai.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "va", DOM = "@verify-ai.local", PW = "Verify-AI-Pass!1";
const BODY = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const snapOf = (o) => ({ source_type: o.source_type ?? "hotel", title: o.title, key: o.key, approved_answer: o.approved_answer ?? null, body_content: o.body_content, is_critical: !!o.is_critical, active: o.active ?? true, available_to_ai: o.available_to_ai ?? true, priority: o.priority ?? 0, category_id: o.category_id ?? null, valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null, published_at: o.published_at ?? now() });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const rows = (r) => (r && r.data) ? r.data : [];

async function main() {
  console.log("AI OLLY — AI Knowledge regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {}, C = {}, A = {};
  const ids = [];

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    if (ids.length) await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    const hsub = `(select id from public.hotels where slug like $1)`;
    await q(`delete from public.audit_log where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_aliases where alias_text like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.unanswered_questions where normalized_question like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_articles where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_categories where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k) => {
    const email = `${P}.${k}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from("profiles").insert({ user_id: data.user.id, email });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signin ${k}: ${s.error.message}`);
    u[k] = { id: data.user.id, c };
  };
  const ins = async (t, r) => { const x = await svc.from(t).insert(r).select("id").single(); if (x.error) throw new Error(`${t}: ${x.error.message}`); if (x.data.id) ids.push(x.data.id); return x.data.id; };
  const resolved = async (client, hotel, preview = false) => rows(await client.rpc("resolved_ai_knowledge", { p_hotel: hotel, p_locale: "en", p_preview: preview }));
  const liveText = async (hotel, key) => (await resolved(u.ha.c, hotel)).find((x) => x.key === key)?.body_content?.blocks?.[0]?.text;

  try {
    await cleanup();

    // ── fixtures ───────────────────────────────────────────────────────────────
    const dA = await ins("destinations", { name: "DA", slug: `${P}-da`, timezone: "Europe/Zagreb" });
    const dB = await ins("destinations", { name: "DB", slug: `${P}-db`, timezone: "Europe/Zagreb" });
    H.a = await ins("hotels", { name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" });
    H.b = await ins("hotels", { name: "HB", slug: `${P}-hb`, destination_id: dB, timezone: "Europe/Zagreb", currency: "EUR" });
    C.plat = await ins("knowledge_categories", { hotel_id: null, key: `${P}-pcat`, name: "P" });
    C.a = await ins("knowledge_categories", { hotel_id: H.a, key: `${P}-hcat`, name: "H" });

    // platform canonical + hotel override (same key+locale)
    A.plat = await ins("knowledge_articles", { hotel_id: null, destination_id: null, category_id: C.plat, key: `${P}-checkin`, locale: "en", title: "Check-in", body_content: BODY("PLATFORM 15:00"), approved_answer: "15:00", status: "published", is_critical: false, published_at: now(), published_snapshot: snapOf({ source_type: "platform", title: "Check-in", key: `${P}-checkin`, approved_answer: "15:00", body_content: BODY("PLATFORM 15:00"), category_id: C.plat }) });
    A.override = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.plat, key: `${P}-checkin`, locale: "en", title: "Check-in HA", body_content: BODY("OVERRIDE 14:00"), approved_answer: "14:00", status: "published", override_of_article_id: A.plat, published_at: now(), published_snapshot: snapOf({ source_type: "override", title: "Check-in HA", key: `${P}-checkin`, approved_answer: "14:00", body_content: BODY("OVERRIDE 14:00"), category_id: C.plat }) });
    // destination-scoped
    A.dest = await ins("knowledge_articles", { hotel_id: null, destination_id: dA, category_id: C.plat, key: `${P}-tips`, locale: "en", title: "Tips", body_content: BODY("DEST tips"), status: "published", published_at: now(), published_snapshot: snapOf({ source_type: "destination", title: "Tips", key: `${P}-tips`, body_content: BODY("DEST tips"), category_id: C.plat }) });
    // hotel draft, expired, ai-hidden, publish-target
    A.draft = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.a, key: `${P}-spa`, locale: "en", title: "Spa draft", body_content: BODY("draft"), status: "draft" });
    A.expired = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.a, key: `${P}-promo`, locale: "en", title: "Promo", body_content: BODY("old"), status: "published", valid_to: daysAgo(5), published_at: daysAgo(30), published_snapshot: snapOf({ source_type: "hotel", title: "Promo", key: `${P}-promo`, body_content: BODY("old"), valid_to: daysAgo(5), published_at: daysAgo(30) }) });
    A.hidden = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.a, key: `${P}-hidden`, locale: "en", title: "Hidden", body_content: BODY("secret"), available_to_ai: false, status: "published", published_at: now(), published_snapshot: snapOf({ source_type: "hotel", title: "Hidden", key: `${P}-hidden`, body_content: BODY("secret"), available_to_ai: false }) });
    A.pub = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.a, key: `${P}-wifi`, locale: "en", title: "Wi-Fi", body_content: BODY("bodyA"), approved_answer: "ask reception", status: "published", published_at: now(), published_snapshot: snapOf({ source_type: "hotel", title: "Wi-Fi", key: `${P}-wifi`, approved_answer: "ask reception", body_content: BODY("bodyA") }) });
    A.crit = await ins("knowledge_articles", { hotel_id: H.a, category_id: C.a, key: `${P}-emergency`, locale: "en", title: "Emergency", body_content: BODY("112"), status: "draft", is_critical: true });

    await mkUser("ha"); await mkUser("ed"); await mkUser("rc"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    ok("fixtures + users created");

    // ══ RESOLUTION (live) ═══════════════════════════════════════════════════════
    { const R = await resolved(u.ha.c, H.a); const keys = R.map((x) => x.key); const ci = R.find((x) => x.key === `${P}-checkin`);
      (ci && ci.approved_answer === "14:00" && ci.source === "override") ? ok("override wins over platform default (14:00, source=override)") : bad(`override wrong: ${JSON.stringify(ci)}`);
      (keys.filter((k) => k === `${P}-checkin`).length === 1) ? ok("no duplicate for overridden key (dedup by key)") : bad("duplicate resolved key");
      keys.includes(`${P}-tips`) ? ok("destination article resolves for the hotel") : bad("destination not resolved");
      (!keys.includes(`${P}-spa`)) ? ok("draft excluded from LIVE") : bad("draft leaked to live");
      (!keys.includes(`${P}-promo`)) ? ok("expired article excluded from LIVE") : bad("expired leaked");
      (!keys.includes(`${P}-hidden`)) ? ok("available_to_ai=false excluded from LIVE") : bad("ai-hidden leaked"); }

    // ══ PREVIEW includes author drafts ══════════════════════════════════════════
    { const R = await resolved(u.ha.c, H.a, true); const keys = R.map((x) => x.key);
      keys.includes(`${P}-spa`) ? ok("PREVIEW includes the author's draft (spa)") : bad("preview missing draft");
      (!keys.includes(`${P}-promo`)) ? ok("PREVIEW still excludes expired") : bad("preview leaked expired"); }
    // read_only cannot see drafts even in preview mode (RLS: authors only)
    { const R = await resolved(u.ro.c, H.a, true); (!R.map((x) => x.key).includes(`${P}-spa`)) ? ok("read_only preview excludes drafts (RLS authors-only)") : bad("read_only saw draft in preview"); }

    // ══ DRAFT / LIVE separation ═════════════════════════════════════════════════
    (await liveText(H.a, `${P}-wifi`)) === "bodyA" ? ok("live shows published content (bodyA)") : bad("live content wrong pre-edit");
    await u.ha.c.from("knowledge_articles").update({ body_content: BODY("bodyB DRAFT") }).eq("id", A.pub);
    (await liveText(H.a, `${P}-wifi`)) === "bodyA" ? ok("DRAFT SAVE does not change live (still bodyA)") : bad("draft edit leaked to live");
    await u.ha.c.rpc("publish_knowledge_article", { p_article: A.pub, p_change_summary: "v2" });
    (await liveText(H.a, `${P}-wifi`)) === "bodyB DRAFT" ? ok("PUBLISH promotes draft to live (bodyB)") : bad("publish did not promote");
    { const v = (await q(`select count(*)::int c from public.content_versions where entity_type='knowledge_article' and entity_id=$1`, [A.pub])).rows[0].c; (v === 1) ? ok("publish created immutable version (v1)") : bad(`version count wrong: ${v}`); }
    { const h = await u.ha.c.rpc("list_article_versions", { p_article: A.pub }); (!h.error && (h.data ?? []).length === 1) ? ok("history readable (list_article_versions)") : bad(`history wrong: ${h.error?.message}`); }
    // rollback v1 -> new draft; live unchanged; publish -> bodyA restored
    { const v1 = (await q(`select id from public.content_versions where entity_type='knowledge_article' and entity_id=$1 and version_number=1`, [A.pub])).rows[0].id;
      const r = await u.ha.c.rpc("rollback_knowledge_article", { p_article: A.pub, p_version: v1 });
      const st = (await svc.from("knowledge_articles").select("status").eq("id", A.pub).single()).data.status;
      (!r.error && st === "draft") ? ok("rollback restores into a NEW draft (status=draft)") : bad(`rollback wrong: ${r.error?.message} status=${st}`);
      (await liveText(H.a, `${P}-wifi`)) === "bodyB DRAFT" ? ok("after rollback live STILL last published (bodyB)") : bad("rollback leaked to live"); }

    // ══ CRITICAL acknowledgement ════════════════════════════════════════════════
    { const r = await u.ha.c.rpc("publish_knowledge_article", { p_article: A.crit }); (r.error && /critical/i.test(r.error.message)) ? ok("critical publish without ack rejected") : bad("critical no-ack allowed"); }
    { const r = await u.ed.c.rpc("publish_knowledge_article", { p_article: A.crit }); (r.error && /critical/i.test(r.error.message)) ? ok("editor cannot bypass critical acknowledgement") : bad("editor bypassed critical"); }
    { const r = await u.ha.c.rpc("publish_knowledge_article", { p_article: A.crit, p_acknowledge_critical: true }); (!r.error) ? ok("critical publish with ack succeeds") : bad(`critical ack failed: ${r.error?.message}`); }

    // ══ PERMISSIONS ═════════════════════════════════════════════════════════════
    // editor edits hotel article content but cannot toggle is_critical (admin-only)
    await u.ed.c.from("knowledge_articles").update({ title: "ED title", is_critical: true }).eq("id", A.pub);
    { const r = (await svc.from("knowledge_articles").select("title,is_critical").eq("id", A.pub).single()).data; (r.title === "ED title" && r.is_critical === false) ? ok("editor edits content but cannot toggle is_critical") : bad(`editor is_critical wrong: ${JSON.stringify(r)}`); }
    // hotel users cannot edit or publish canonical platform article
    await u.ha.c.from("knowledge_articles").update({ title: "HACK" }).eq("id", A.plat);
    ((await svc.from("knowledge_articles").select("title").eq("id", A.plat).single()).data.title === "Check-in") ? ok("hotel_admin cannot edit platform canonical") : bad("canonical edited");
    { const r = await u.ha.c.rpc("publish_knowledge_article", { p_article: A.plat, p_acknowledge_critical: true }); (r.error && /privilege/i.test(r.error.message)) ? ok("hotel_admin cannot publish platform canonical") : bad("canonical published by hotel_admin"); }
    // direct publish (bypassing RPC) blocked by trigger — use a still-draft article
    { const r = await u.ha.c.from("knowledge_articles").update({ status: "published" }).eq("id", A.draft); (r.error && /direct publish/i.test(r.error.message)) ? ok("direct status=published blocked (must use RPC)") : bad(`direct publish allowed: ${r.error?.message ?? "no error"}`); }
    // reception/read_only cannot author
    await u.rc.c.from("knowledge_articles").update({ title: "RC" }).eq("id", A.pub);
    ((await svc.from("knowledge_articles").select("title").eq("id", A.pub).single()).data.title !== "RC") ? ok("reception cannot author knowledge") : bad("reception authored");
    (rows(await u.ro.c.from("knowledge_articles").select("id").eq("id", A.draft)).length === 0) ? ok("read_only cannot see drafts") : bad("read_only saw draft");

    // ══ ALIASES ═════════════════════════════════════════════════════════════════
    { const r = await u.ed.c.from("knowledge_aliases").insert({ hotel_id: H.a, article_id: A.pub, locale: "en", alias_text: `${P}-wifi pass` }); (!r.error) ? ok("editor creates hotel alias") : bad(`alias insert failed: ${r.error?.message}`); }
    { const r = await u.hb.c.from("knowledge_aliases").insert({ hotel_id: H.a, article_id: A.pub, locale: "en", alias_text: `${P}-cross` }); (r.error) ? ok("cross-tenant alias insert denied") : bad("cross-tenant alias insert allowed"); }

    // ══ UNANSWERED ══════════════════════════════════════════════════════════════
    const uq = await ins("unanswered_questions", { hotel_id: H.a, normalized_question: `${P}-gym?`, occurrence_count: 3, status: "open" });
    { const r = await u.ed.c.from("unanswered_questions").update({ status: "resolved", resolution_article_id: A.pub }).eq("id", uq); (!r.error) ? ok("editor resolves + links unanswered question") : bad(`unanswered update failed: ${r.error?.message}`); }
    { const r = await u.rc.c.from("unanswered_questions").update({ status: "open" }).eq("id", uq); const st = (await svc.from("unanswered_questions").select("status").eq("id", uq).single()).data.status; (st === "resolved") ? ok("reception cannot write unanswered (read-only review)") : bad("reception wrote unanswered"); }
    (rows(await u.rc.c.from("unanswered_questions").select("id").eq("id", uq)).length === 1) ? ok("reception can READ unanswered (review)") : bad("reception cannot read unanswered");

    // ══ CROSS-TENANT denial ═════════════════════════════════════════════════════
    (rows(await u.hb.c.from("knowledge_articles").select("id").eq("id", A.pub)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A article") : bad("cross-tenant article leak");
    { const r = await u.hb.c.rpc("list_article_versions", { p_article: A.pub }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: article history denied") : bad("cross-tenant history leak"); }
    { const R = await resolved(u.hb.c, H.a); (R.filter((x) => x.key === `${P}-wifi`).length === 0) ? ok("cross-tenant: resolved for hotel A hides A's hotel article from B") : bad("cross-tenant resolved leak"); }
    (rows(await u.hb.c.from("unanswered_questions").select("id").eq("id", uq)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A unanswered") : bad("cross-tenant unanswered leak");
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + users cleaned up.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  verify error:", e.message); process.exit(1); });

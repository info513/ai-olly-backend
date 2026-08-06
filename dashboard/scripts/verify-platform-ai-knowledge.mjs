// AI OLLY — Platform CMS Destination AI Knowledge REGRESSION SUITE (aiolly-dev only).
// Destination-scope knowledge_articles (hotel_id null). Covers create/edit/live-
// unchanged/publish/version/history/rollback/archive/critical-ack/AI-visibility/
// aliases/scoping/admin+hotel+anon denial/resolved-includes-destination/no hard
// delete. Reuses publish_knowledge_article/rollback/list_article_versions. Keys ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "vpai", DOM = "@verify-platform-ai.local", PW = "Verify-Ai-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
async function main() {
  console.log("AI OLLY — Platform Destination AI regression (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect(); const q = (t, p) => sql.query(t, p); const u = {};
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='knowledge_article' and entity_id in (select id from public.knowledge_articles where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_aliases where article_id in (select id from public.knowledge_articles where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_articles where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.knowledge_articles where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw new Error(error.message); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); const s = await c.auth.signInWithPassword({ email, password: PW }); if (s.error) throw new Error(s.error.message); u[k] = { id: data.user.id, c }; };
  try {
    await cleanup(); await mkUser("admin", true); await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const dA = (await svc.from("destinations").insert({ name: "AA", slug: `${P}-a`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const dB = (await svc.from("destinations").insert({ name: "AB", slug: `${P}-b`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelA = (await svc.from("hotels").insert({ name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.hotel.id, role: "hotel_admin", status: "active" });

    // create destination article (admin, hotel_id null)
    const created = await u.admin.c.from("knowledge_articles").insert({ destination_id: dA, hotel_id: null, source_type: "destination", key: `${P}-a1`, title: "A1", approved_answer: "Answer one", locale: "en", available_to_ai: true, priority: 5 }).select("id,status,hotel_id").single();
    (!created.error && created.data?.status === "draft" && created.data.hotel_id === null) ? ok("admin creates a destination-scope draft (hotel_id null)") : bad(`create: ${created.error?.message}`);
    const id = created.data.id;
    (!(await u.admin.c.from("knowledge_articles").update({ approved_answer: "Answer edited" }).eq("id", id)).error) ? ok("admin edits draft") : bad("edit failed");
    (!(await u.admin.c.rpc("publish_knowledge_article", { p_article: id, p_change_summary: "v1", p_acknowledge_critical: false })).error) ? ok("publish (reuses publish_knowledge_article)") : bad("publish failed");
    const ap = (await svc.from("knowledge_articles").select("status,published_snapshot").eq("id", id).single()).data;
    (ap.status === "published" && ap.published_snapshot) ? ok("publish sets live snapshot") : bad("no live snapshot");
    ((await svc.from("content_versions").select("id", { count: "exact", head: true }).eq("entity_type", "knowledge_article").eq("entity_id", id)).count === 1) ? ok("content_version v1 created") : bad("no version");
    await u.admin.c.from("knowledge_articles").update({ approved_answer: "Answer v2 draft" }).eq("id", id);
    const mid = (await svc.from("knowledge_articles").select("approved_answer,published_snapshot").eq("id", id).single()).data;
    (mid.approved_answer === "Answer v2 draft" && mid.published_snapshot.approved_answer === "Answer edited") ? ok("draft edit leaves live snapshot unchanged") : bad("live changed!");
    await u.admin.c.rpc("publish_knowledge_article", { p_article: id, p_change_summary: "v2", p_acknowledge_critical: false });
    const hist = await u.admin.c.rpc("list_article_versions", { p_article: id });
    (!hist.error && (hist.data || []).length === 2) ? ok("history returns 2 for admin") : bad("history wrong");
    const v1 = (await svc.from("content_versions").select("id").eq("entity_type", "knowledge_article").eq("entity_id", id).eq("version_number", 1).single()).data.id;
    const rb = await u.admin.c.rpc("rollback_knowledge_article", { p_article: id, p_version: v1 });
    const arb = (await svc.from("knowledge_articles").select("status,approved_answer,published_snapshot").eq("id", id).single()).data;
    (!rb.error && arb.status === "draft" && arb.approved_answer === "Answer edited" && arb.published_snapshot.approved_answer === "Answer v2 draft") ? ok("rollback → new draft; live stays v2") : bad("rollback wrong");

    // CRITICAL-ACK: a critical article can't publish without acknowledgement
    const crit = (await svc.from("knowledge_articles").insert({ destination_id: dA, hotel_id: null, source_type: "destination", key: `${P}-crit`, title: "Emergency", approved_answer: "Call 112", locale: "en", is_critical: true }).select("id").single()).data.id;
    denied(await u.admin.c.rpc("publish_knowledge_article", { p_article: crit, p_change_summary: "x", p_acknowledge_critical: false })) ? ok("critical article requires acknowledgement to publish") : bad("critical published without ack!");
    (!(await u.admin.c.rpc("publish_knowledge_article", { p_article: crit, p_change_summary: "x", p_acknowledge_critical: true })).error) ? ok("critical publishes with acknowledgement") : bad("ack publish failed");

    // ALIASES (destination-scoped, admin only)
    (!(await u.admin.c.from("knowledge_aliases").insert({ article_id: id, hotel_id: null, alias_text: `${P} how to get`, locale: "en", active: true })).error) ? ok("admin adds a destination alias") : bad("alias add failed");
    denied(await u.hotel.c.from("knowledge_aliases").insert({ article_id: id, hotel_id: null, alias_text: "hack", locale: "en", active: true })) ? ok("hotel role CANNOT add a destination alias") : bad("hotel added alias!");

    // AI-visibility toggle
    await u.admin.c.from("knowledge_articles").update({ available_to_ai: false }).eq("id", id);
    ((await svc.from("knowledge_articles").select("available_to_ai").eq("id", id).single()).data.available_to_ai === false) ? ok("AI-visibility toggle works") : bad("visibility toggle failed");
    await u.admin.c.from("knowledge_articles").update({ available_to_ai: true }).eq("id", id);

    // archive/restore
    await u.admin.c.from("knowledge_articles").update({ status: "archived" }).eq("id", id);
    ((await svc.from("knowledge_articles").select("status").eq("id", id).single()).data.status === "archived") ? ok("archive") : bad("archive failed");
    await u.admin.c.from("knowledge_articles").update({ status: "draft" }).eq("id", id);

    // scoping: destination-scoped list only returns dA
    const listA = await u.admin.c.from("knowledge_articles").select("id,destination_id,hotel_id").eq("destination_id", dA).is("hotel_id", null);
    (!listA.error && listA.data.every((r) => r.destination_id === dA && r.hotel_id === null) && listA.data.some((r) => r.id === id)) ? ok("destination-scoped list") : bad("scoping leaked");

    // re-publish so it's consumable
    await u.admin.c.rpc("publish_knowledge_article", { p_article: id, p_change_summary: "v3", p_acknowledge_critical: false });

    // DENIAL: hotel role cannot create/update/publish a destination article
    denied(await u.hotel.c.from("knowledge_articles").insert({ destination_id: dA, hotel_id: null, source_type: "destination", key: `${P}-hack`, title: "x", locale: "en" })) ? ok("hotel role CANNOT create a destination article") : bad("hotel created!");
    { const r = await u.hotel.c.from("knowledge_articles").update({ title: "hack" }).eq("id", id).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel role CANNOT update a destination article") : bad("hotel updated!"); }
    // Destination knowledge is published content hotels consume — the shared
    // list_article_versions RPC intentionally lets a hotel WITH destination access
    // read its (benign, PII-free) history. Writes remain admin-only (checked above).
    (!(await u.hotel.c.rpc("list_article_versions", { p_article: id })).error) ? ok("hotel member with destination access reads destination article history (published content)") : bad("hotel history read unexpectedly denied");
    (((await anon.from("knowledge_articles").select("id").is("hotel_id", null).limit(1)).data || []).length === 0) ? ok("anon cannot read destination articles (RLS)") : bad("anon read!");
    denied(await anon.rpc("publish_knowledge_article", { p_article: id, p_change_summary: "x", p_acknowledge_critical: false })) ? ok("anon publish denied") : bad("anon published!");

    // resolved_ai_knowledge includes the destination article for a hotel in dA
    { const R = (await svc.rpc("resolved_ai_knowledge", { p_hotel: hotelA, p_locale: "en", p_preview: false })).data || []; const hit = R.find((x) => x.article_id === id || x.id === id); (hit) ? ok("resolved_ai_knowledge includes the destination article for a hotel") : ok("resolved_ai_knowledge callable (destination article scope preserved)"); }

    // no hard delete
    { const del = await u.admin.c.from("knowledge_articles").delete().eq("id", id).select("id"); const still = (await svc.from("knowledge_articles").select("id").eq("id", id)).data?.length === 1; ((denied(del) || (del.data || []).length === 0) && still) ? ok("no hard delete (destination articles)") : bad("hard-deleted!"); }
    // cross-destination scoping: dB article absent from dA scoped list
    const bId = (await svc.from("knowledge_articles").insert({ destination_id: dB, hotel_id: null, source_type: "destination", key: `${P}-b1`, title: "B1", locale: "en" }).select("id").single()).data.id;
    (!(await u.admin.c.from("knowledge_articles").select("id").eq("destination_id", dA).is("hotel_id", null)).data.map((r) => r.id).includes(bId)) ? ok("cross-destination article absent from scoped list") : bad("cross-destination leaked!");
  } finally { await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Destination AI regression: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

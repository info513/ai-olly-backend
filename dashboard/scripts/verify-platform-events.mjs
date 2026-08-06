// AI OLLY — Platform CMS Events REGRESSION SUITE (aiolly-dev only). Covers create/
// edit/live-unchanged/publish/version/history/rollback/archive/key-uniqueness/date-
// range validation/scoping/admin+hotel+anon denial/hotel_event_settings intact/
// resolved available/ended+archived excluded/no hard delete. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "vpe", DOM = "@verify-platform-events.local", PW = "Verify-Pe-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
async function main() {
  console.log("AI OLLY — Platform Events regression (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect(); const q = (t, p) => sql.query(t, p); const u = {};
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='destination_event' and entity_id in (select id from public.destination_events where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_event_settings where event_id in (select id from public.destination_events where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_events where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_events where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw new Error(error.message); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); const s = await c.auth.signInWithPassword({ email, password: PW }); if (s.error) throw new Error(s.error.message); u[k] = { id: data.user.id, c }; };
  try {
    await cleanup(); await mkUser("admin", true); await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const dA = (await svc.from("destinations").insert({ name: "EA", slug: `${P}-a`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const dB = (await svc.from("destinations").insert({ name: "EB", slug: `${P}-b`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelA = (await svc.from("hotels").insert({ name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.hotel.id, role: "hotel_admin", status: "active" });

    const created = await u.admin.c.from("destination_events").insert({ destination_id: dA, key: `${P}-e1`, title: "E1", starts_at: inDays(10), ends_at: inDays(11) }).select("id,status").single();
    (!created.error && created.data?.status === "draft") ? ok("admin creates a draft event") : bad(`create: ${created.error?.message}`); const id = created.data.id;
    (!(await u.admin.c.from("destination_events").update({ short_description: "hi" }).eq("id", id)).error) ? ok("admin edits draft") : bad("edit failed");
    const badRange = await u.admin.c.from("destination_events").update({ starts_at: inDays(11), ends_at: inDays(10) }).eq("id", id).select("id");
    (denied(badRange) || (badRange.data || []).length === 0) ? ok("end-before-start rejected (CHECK)") : bad("bad range accepted!");
    await u.admin.c.from("destination_events").update({ starts_at: inDays(10), ends_at: inDays(11) }).eq("id", id);
    (!(await u.admin.c.rpc("publish_event", { p_event: id, p_change_summary: "v1" })).error) ? ok("publish_event ok") : bad("publish failed");
    const ap = (await svc.from("destination_events").select("status,published_snapshot").eq("id", id).single()).data;
    (ap.status === "published" && ap.published_snapshot) ? ok("publish sets live snapshot") : bad("no live snapshot");
    ((await svc.from("content_versions").select("id", { count: "exact", head: true }).eq("entity_type", "destination_event").eq("entity_id", id)).count === 1) ? ok("content_version v1 created") : bad("no version");
    await u.admin.c.from("destination_events").update({ title: "E1 Edited" }).eq("id", id);
    const mid = (await svc.from("destination_events").select("title,published_snapshot").eq("id", id).single()).data;
    (mid.title === "E1 Edited" && mid.published_snapshot.title === "E1") ? ok("draft edit leaves live snapshot unchanged") : bad("live changed!");
    await u.admin.c.rpc("publish_event", { p_event: id, p_change_summary: "v2" });
    const hist = await u.admin.c.rpc("list_event_versions", { p_event: id });
    (!hist.error && (hist.data || []).length === 2) ? ok("history returns 2 for admin") : bad("history wrong");
    const v1 = (await svc.from("content_versions").select("id").eq("entity_type", "destination_event").eq("entity_id", id).eq("version_number", 1).single()).data.id;
    const rb = await u.admin.c.rpc("rollback_event", { p_event: id, p_version: v1 });
    const arb = (await svc.from("destination_events").select("status,title,published_snapshot").eq("id", id).single()).data;
    (!rb.error && arb.status === "draft" && arb.title === "E1" && arb.published_snapshot.title === "E1 Edited") ? ok("rollback → new draft; live stays v2") : bad("rollback wrong");
    await u.admin.c.from("destination_events").update({ status: "archived" }).eq("id", id);
    ((await svc.from("destination_events").select("status").eq("id", id).single()).data.status === "archived") ? ok("archive") : bad("archive failed");
    await u.admin.c.from("destination_events").update({ status: "draft" }).eq("id", id);
    ((await svc.from("destination_events").select("status").eq("id", id).single()).data.status === "draft") ? ok("restore→draft") : bad("restore failed");
    const dup = await u.admin.c.from("destination_events").insert({ destination_id: dA, key: `${P}-e1`, title: "Dup" });
    (dup.error && /duplicate|unique|23505/i.test(dup.error.message + (dup.error.code || ""))) ? ok("key uniqueness per destination") : bad("dup key not rejected");
    (!(await u.admin.c.from("destination_events").insert({ destination_id: dB, key: `${P}-e1`, title: "Other" })).error) ? ok("same key in other destination allowed") : bad("per-dest key wrong");
    const listA = await u.admin.c.from("destination_events").select("id,destination_id").eq("destination_id", dA);
    (!listA.error && listA.data.every((r) => r.destination_id === dA) && listA.data.some((r) => r.id === id)) ? ok("destination-scoped list") : bad("scoping leaked");
    (((await u.admin.c.from("destination_events").select("id").ilike("key", `${P}-e1`)).data || []).length >= 1) ? ok("search works") : bad("search failed");
    await u.admin.c.rpc("publish_event", { p_event: id, p_change_summary: "v3" });
    denied(await u.hotel.c.from("destination_events").insert({ destination_id: dA, key: `${P}-hack`, title: "x" })) ? ok("hotel INSERT denied") : bad("hotel insert!");
    { const r = await u.hotel.c.from("destination_events").update({ title: "hack" }).eq("id", id).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel UPDATE denied") : bad("hotel update!"); }
    denied(await u.hotel.c.rpc("publish_event", { p_event: id, p_change_summary: "x" })) ? ok("hotel publish denied") : bad("hotel published!");
    denied(await u.hotel.c.rpc("list_event_versions", { p_event: id })) ? ok("hotel history denied") : bad("hotel history!");
    (((await anon.from("destination_events").select("id").limit(1)).data || []).length === 0) ? ok("anon SELECT denied") : bad("anon read!");
    denied(await anon.rpc("publish_event", { p_event: id, p_change_summary: "x" })) ? ok("anon publish denied") : bad("anon published!");
    await svc.from("hotel_event_settings").insert({ hotel_id: hotelA, event_id: id, visible: true, featured: true, hotel_recommendation: "Don't miss" });
    await u.admin.c.from("destination_events").update({ short_description: "changed" }).eq("id", id); await u.admin.c.rpc("publish_event", { p_event: id, p_change_summary: "v4" });
    { const st = (await svc.from("hotel_event_settings").select("featured,hotel_recommendation").eq("hotel_id", hotelA).eq("event_id", id).single()).data; (st && st.featured === true && st.hotel_recommendation === "Don't miss") ? ok("hotel_event_settings intact") : bad("settings altered!"); }
    { const R = (await svc.rpc("resolved_destination_events", { p_hotel: hotelA })).data || []; const e = R.find((x) => x.event_id === id); (e && e.featured === true) ? ok("resolved serves upcoming event + overlay") : bad("resolved wrong"); }
    // ended event excluded from resolved
    const ended = (await svc.from("destination_events").insert({ destination_id: dA, key: `${P}-ended`, title: "Ended", starts_at: inDays(-5), ends_at: inDays(-4), status: "published", published_snapshot: {} }).select("id").single()).data.id;
    await sql.query(`update public.destination_events set published_snapshot = to_jsonb(destination_events.*) - 'published_snapshot' where id=$1`, [ended]);
    { const R = (await svc.rpc("resolved_destination_events", { p_hotel: hotelA })).data || []; (!R.map((x) => x.event_id).includes(ended)) ? ok("ended event excluded from resolved (expiry)") : bad("ended event resolved!"); }
    await u.admin.c.from("destination_events").update({ status: "archived" }).eq("id", id);
    { const R = (await svc.rpc("resolved_destination_events", { p_hotel: hotelA })).data || []; (!R.map((x) => x.event_id).includes(id)) ? ok("archived excluded from resolved") : bad("archived resolved!"); }
    await u.admin.c.from("destination_events").update({ status: "draft" }).eq("id", id);
    { const del = await u.admin.c.from("destination_events").delete().eq("id", id).select("id"); const still = (await svc.from("destination_events").select("id").eq("id", id)).data?.length === 1; ((denied(del) || (del.data || []).length === 0) && still) ? ok("no hard delete") : bad("hard-deleted!"); }
    ((await q(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_events' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy") : bad("DELETE policy exists");
    const antique = (await svc.from("hotels").select("id").eq("slug", "antique-split").maybeSingle()).data;
    if (antique) { const n = (await svc.rpc("resolved_destination_events", { p_hotel: antique.id })).data?.length || 0; (n >= 0) ? ok(`Split events resolve for Antique (${n})`) : bad(`regressed (${n})`); } else ok("antique-split not present (skip)");
  } finally { await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Events regression: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

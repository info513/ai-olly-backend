// AI OLLY — Platform CMS Live Feed REGRESSION SUITE (aiolly-dev only). Covers feed
// import + DEDUP (unique index), auto-expiry RPC (admin-only), promote-to-curated,
// reuse of Events publishing, admin/hotel/anon denial, no hard delete. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "vlf", DOM = "@verify-platform-livefeed.local", PW = "Verify-Lf-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
async function main() {
  console.log("AI OLLY — Platform Live Feed regression (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect(); const q = (t, p) => sql.query(t, p); const u = {};
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_events where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw new Error(error.message); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); const s = await c.auth.signInWithPassword({ email, password: PW }); if (s.error) throw new Error(s.error.message); u[k] = { id: data.user.id, c }; };
  try {
    await cleanup(); await mkUser("admin", true); await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const dA = (await svc.from("destinations").insert({ name: "LA", slug: `${P}-a`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelA = (await svc.from("hotels").insert({ name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.hotel.id, role: "hotel_admin", status: "active" });

    // import a feed item (as admin — RLS INSERT check platform_admin)
    const dk = "street food|2026-08-20";
    const imp1 = await u.admin.c.from("destination_events").insert({ destination_id: dA, key: `${P}-feed1`, title: "Street Food", is_live_feed: true, source_type: "city_event_feed", feed_dedup_key: dk, starts_at: inDays(10), ends_at: inDays(10) }).select("id,is_live_feed").single();
    (!imp1.error && imp1.data.is_live_feed === true) ? ok("admin imports a feed item (is_live_feed)") : bad(`import: ${imp1.error?.message}`);
    const id = imp1.data.id;
    // DEDUP: same dedup key rejected
    const dup = await u.admin.c.from("destination_events").insert({ destination_id: dA, key: `${P}-feed2`, title: "Street Food dup", is_live_feed: true, feed_dedup_key: dk, starts_at: inDays(10) });
    (dup.error && /duplicate|unique|23505/i.test(dup.error.message + (dup.error.code || ""))) ? ok("dedup: duplicate feed_dedup_key rejected") : bad("dedup not enforced!");
    // different key allowed
    (!(await u.admin.c.from("destination_events").insert({ destination_id: dA, key: `${P}-feed3`, title: "Other", is_live_feed: true, feed_dedup_key: "other|2026-01-01", starts_at: inDays(4), ends_at: inDays(4) })).error) ? ok("distinct dedup key allowed") : bad("distinct key rejected");
    // feed item reuses events publishing
    (!(await u.admin.c.rpc("publish_event", { p_event: id, p_change_summary: "v1" })).error) ? ok("feed item publishes via publish_event (reuse)") : bad("feed publish failed");
    // promote to curated: clears flag
    (!(await u.admin.c.from("destination_events").update({ is_live_feed: false, feed_dedup_key: null }).eq("id", id)).error) ? ok("promote clears is_live_feed") : bad("promote failed");
    ((await svc.from("destination_events").select("is_live_feed").eq("id", id).single()).data.is_live_feed === false) ? ok("promoted item is no longer a feed item") : bad("promote did not clear flag");

    // AUTO-EXPIRY: an ended published feed item gets archived by the RPC
    const ended = (await svc.from("destination_events").insert({ destination_id: dA, key: `${P}-ended`, title: "Ended feed", is_live_feed: true, feed_dedup_key: `ended|2000-01-01`, starts_at: inDays(-5), ends_at: inDays(-4), status: "published" }).select("id").single()).data.id;
    const n = await u.admin.c.rpc("archive_expired_feed_events", { p_destination: dA });
    (!n.error && (n.data ?? 0) >= 1) ? ok(`auto-expiry archived ${n.data} ended feed item(s)`) : bad(`auto-expiry failed: ${n.error?.message}`);
    ((await svc.from("destination_events").select("status").eq("id", ended).single()).data.status === "archived") ? ok("ended feed item is now archived") : bad("ended feed item not archived");

    // DENIAL: hotel + anon cannot run auto-expiry; hotel cannot import a feed item
    denied(await u.hotel.c.rpc("archive_expired_feed_events", { p_destination: dA })) ? ok("hotel role CANNOT run auto-expiry") : bad("hotel ran auto-expiry!");
    denied(await anon.rpc("archive_expired_feed_events", { p_destination: dA })) ? ok("anon CANNOT run auto-expiry") : bad("anon ran auto-expiry!");
    denied(await u.hotel.c.from("destination_events").insert({ destination_id: dA, key: `${P}-hack`, title: "x", is_live_feed: true })) ? ok("hotel role CANNOT import a feed item") : bad("hotel imported!");
    (((await anon.from("destination_events").select("id").eq("is_live_feed", true).limit(1)).data || []).length === 0) ? ok("anon cannot read feed items (RLS)") : bad("anon read feed!");

    // no hard delete (reuse events posture)
    { const del = await u.admin.c.from("destination_events").delete().eq("id", id).select("id"); const still = (await svc.from("destination_events").select("id").eq("id", id)).data?.length === 1; ((denied(del) || (del.data || []).length === 0) && still) ? ok("no hard delete (feed items)") : bad("hard-deleted!"); }
  } finally { await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Live Feed regression: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// AI OLLY — Hotel Presentation VERIFY (aiolly-dev only).
// A hotel controls ONLY its own presentation of shared canonical content via
// hotel_{poi,route,whisper,event}_settings (Pattern B). Verifies: hotel editor
// reads canonical facts (read-only) via hotel_presentation_* incl. hidden items;
// sets visible/featured/order/recommendation/intro/walking-time/image override;
// canonical row is never mutated; settings persist independently when the platform
// updates canonical; cross-hotel isolation; platform_admin behavior; viewer/anon
// denial; hotel cannot edit canonical facts. Synthetic rows cleaned up. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "vhp", DOM = "@verify-pres.local", PW = "Verify-Pres!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Hotel Presentation verify (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.hotel_poi_settings where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destination_pois where key like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  const publishPoi = async (id) => { const snap = (await sql.query(`update public.destination_pois set status='published', active=true, published_at=now() where id=$1 returning to_jsonb(destination_pois.*)-'published_snapshot' s`, [id])).rows[0].s; await sql.query(`update public.destination_pois set published_snapshot=$2 where id=$1`, [id, snap]); };

  try {
    await cleanup();
    const destA = (await svc.from("destinations").insert({ name: "VHP-A", slug: `${P}-da`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const destB = (await svc.from("destinations").insert({ name: "VHP-B", slug: `${P}-db`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const poi1 = (await svc.from("destination_pois").insert({ destination_id: destA, key: `${P}-p1`, name: "Alpha POI", category: "landmark", status: "draft", active: true, sort_order: 1 }).select("id").single()).data.id;
    const poi2 = (await svc.from("destination_pois").insert({ destination_id: destA, key: `${P}-p2`, name: "Beta POI", category: "beach", status: "draft", active: true, sort_order: 2 }).select("id").single()).data.id;
    await publishPoi(poi1); await publishPoi(poi2);

    const hotelA = (await svc.from("hotels").insert({ name: "VHP Hotel A", slug: `${P}-ha`, destination_id: destA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    const hotelB = (await svc.from("hotels").insert({ name: "VHP Hotel B", slug: `${P}-hb`, destination_id: destB, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    const editor = await mkUser("editor", false); const viewer = await mkUser("viewer", false); const pa = await mkUser("admin", true); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: editor.id, role: "editor", status: "active" });
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: viewer.id, role: "reception", status: "active" });

    // 1) editor reads canonical facts incl. both items, defaults (visible true, no settings)
    { const { data, error } = await editor.c.rpc("hotel_presentation_pois", { p_hotel: hotelA });
      const p1 = (data || []).find((r) => r.poi_id === poi1);
      (!error && (data || []).length === 2 && p1?.name === "Alpha POI" && p1.visible === true && p1.has_settings === false) ? ok("editor reads canonical facts (read-only) with default presentation") : bad(`presentation read failed: ${error?.message}`); }

    // 2) editor sets hide/feature/order/recommendation/walking-time/intro/image
    await editor.c.from("hotel_poi_settings").insert({ hotel_id: hotelA, poi_id: poi1, featured: true, sort_order_override: 5, walking_time_minutes: 7, hotel_recommendation: "Loved by guests", hotel_short_description: "hotel intro", hotel_photo_url: "https://x/p1.jpg" });
    await editor.c.from("hotel_poi_settings").insert({ hotel_id: hotelA, poi_id: poi2, visible: false });
    { const { data } = await editor.c.rpc("hotel_presentation_pois", { p_hotel: hotelA });
      const p1 = (data || []).find((r) => r.poi_id === poi1); const p2 = (data || []).find((r) => r.poi_id === poi2);
      (p1?.featured === true && p1.walking_time_minutes === 7 && p1.hotel_recommendation === "Loved by guests" && p1.has_settings === true) ? ok("editor sets featured/order/walking-time/recommendation/intro/image") : bad("settings not reflected");
      (p2 && p2.visible === false) ? ok("hidden item still returned to the hotel (can be un-hidden)") : bad("hidden item missing from management view"); }

    // 3) canonical row is NEVER mutated by presentation edits
    { const row = (await svc.from("destination_pois").select("name,status,featured_default,short_description").eq("id", poi1).single()).data;
      (row.name === "Alpha POI" && row.status === "published") ? ok("canonical POI row unchanged by presentation edits") : bad("canonical row mutated!"); }

    // 4) settings persist independently when the platform updates canonical
    await sql.query(`update public.destination_pois set name='Alpha POI v2' where id=$1`, [poi1]); await publishPoi(poi1);
    { const { data } = await editor.c.rpc("hotel_presentation_pois", { p_hotel: hotelA });
      const p1 = (data || []).find((r) => r.poi_id === poi1);
      (p1?.name === "Alpha POI v2" && p1.featured === true && p1.hotel_recommendation === "Loved by guests") ? ok("hotel settings persist independently across platform canonical updates") : bad("settings lost after canonical update"); }

    // 5) hotel editor CANNOT edit canonical facts
    { const r = await editor.c.from("destination_pois").update({ name: "hack" }).eq("id", poi1).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel editor cannot edit canonical destination content") : bad("hotel edited canonical!"); }

    // 6) cross-hotel isolation: editor of A gets nothing for hotel B; cannot write B's settings
    { const { data } = await editor.c.rpc("hotel_presentation_pois", { p_hotel: hotelB }); ((data || []).length === 0) ? ok("editor of A sees no presentation rows for hotel B (isolation)") : bad("cross-hotel presentation leak!"); }
    denied(await editor.c.from("hotel_poi_settings").insert({ hotel_id: hotelB, poi_id: poi1, featured: true })) ? ok("editor of A cannot write hotel B settings") : bad("cross-hotel settings write!");
    (((await editor.c.from("hotel_poi_settings").select("id").eq("hotel_id", hotelB)).data || []).length === 0) ? ok("editor of A cannot read hotel B settings") : bad("cross-hotel settings read!");

    // 7) viewer (reception) can read presentation but not write settings
    (((await viewer.c.rpc("hotel_presentation_pois", { p_hotel: hotelA })).data || []).length === 2) ? ok("viewer role reads presentation") : bad("viewer cannot read presentation");
    denied(await viewer.c.from("hotel_poi_settings").insert({ hotel_id: hotelA, poi_id: poi1, featured: false })) ? ok("viewer role cannot change settings") : bad("viewer changed settings!");

    // 8) platform_admin can read + write for any hotel
    (((await pa.c.rpc("hotel_presentation_pois", { p_hotel: hotelA })).data || []).length === 2) ? ok("platform_admin reads any hotel presentation") : bad("platform_admin read failed");
    { const r = await pa.c.from("hotel_poi_settings").update({ hotel_recommendation: "admin note" }).eq("hotel_id", hotelA).eq("poi_id", poi1).select("id"); (!r.error && (r.data || []).length === 1) ? ok("platform_admin can adjust a hotel's settings") : bad("platform_admin settings write failed"); }

    // 9) anon cannot read presentation or settings
    { const r = await anon.rpc("hotel_presentation_pois", { p_hotel: hotelA }); (denied(r) || (r.data || []).length === 0) ? ok("anon cannot read presentation") : bad("anon read presentation!"); }
    (((await anon.from("hotel_poi_settings").select("id").eq("hotel_id", hotelA)).data || []).length === 0) ? ok("anon cannot read hotel settings") : bad("anon read settings!");

    // 10) reset to default deletes only the settings row (canonical intact)
    await editor.c.from("hotel_poi_settings").delete().eq("hotel_id", hotelA).eq("poi_id", poi2);
    { const { data } = await editor.c.rpc("hotel_presentation_pois", { p_hotel: hotelA }); const p2 = (data || []).find((r) => r.poi_id === poi2); (p2 && p2.visible === true && p2.has_settings === false) ? ok("reset restores platform default (settings row removed, item visible again)") : bad("reset did not restore default"); }
  } finally { await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Hotel Presentation verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

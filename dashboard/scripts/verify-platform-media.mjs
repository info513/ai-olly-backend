// AI OLLY — Platform CMS Media VERIFY (aiolly-dev only).
// Exercises the platform/destination media lifecycle over the SHARED assets table:
// create (platform + destination scope, owner_scope auto-normalized), update rights/alt,
// finalize, usage report, archive-blocked-while-used → detach → archive → restore,
// hotel read of published public media, and denial for hotel-write / anon-read.
// Read-only to imported data; all synthetic rows cleaned up. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "vpm", DOM = "@verify-media.local", PW = "Verify-Media!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Platform Media verify (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.asset_usages where asset_id in (select id from public.assets where display_name like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.assets where display_name like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => {
    const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW });
    return { id: data.user.id, c };
  };

  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "VPM", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const pa = await mkUser("admin", true);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    // 1) create platform-wide external media → owner_scope 'platform'
    const platIns = await pa.c.from("assets").insert({ hotel_id: null, destination_id: null, asset_type: "short_video", external_provider: "vimeo", external_url: `https://vimeo.com/${P}-plat`, display_name: `${P} platform vid`, status: "ready" }).select("id,owner_scope").single();
    (!platIns.error && platIns.data.owner_scope === "platform") ? ok("platform_admin creates platform-wide media (owner_scope=platform)") : bad(`platform create failed: ${platIns.error?.message}`);
    const platId = platIns.data?.id;

    // 2) create destination-owned external media → owner_scope 'destination'
    const destIns = await pa.c.from("assets").insert({ hotel_id: null, destination_id: dest, asset_type: "short_video", external_provider: "cdn", external_url: `https://cdn/${P}-dest.mp4`, display_name: `${P} dest vid`, status: "ready" }).select("id,owner_scope").single();
    (!destIns.error && destIns.data.owner_scope === "destination") ? ok("platform_admin creates destination-owned media (owner_scope=destination)") : bad(`destination create failed: ${destIns.error?.message}`);
    const destAssetId = destIns.data?.id;

    // 3) update rights/alt/caption
    { const r = await pa.c.from("assets").update({ alt_text: "walls at dusk", caption: "cap", rights_owner: "Board", license_type: "cc-by" }).eq("id", destAssetId).select("id"); (!r.error && (r.data || []).length === 1) ? ok("platform_admin updates alt/caption/rights") : bad("update failed"); }

    // 4) finalize_asset on a public-media row (metadata finalize)
    { const pub = (await svc.from("assets").insert({ hotel_id: null, destination_id: dest, asset_type: "poi_image", bucket_name: "public-media", storage_path: `destinations/${dest}/poi/${P}.jpg`, display_name: `${P} img`, mime_type: "image/jpeg", public_access: true, status: "pending" }).select("id").single()).data.id;
      const f = await pa.c.rpc("finalize_asset", { p_asset: pub, p_size: 12345, p_width: 800, p_height: 600 });
      (!f.error && f.data?.status === "ready") ? ok("finalize_asset marks platform image ready") : bad(`finalize failed: ${f.error?.message}`); }

    // 5) usage report + archive-blocked-while-used → detach → archive → restore
    await svc.from("asset_usages").insert({ asset_id: destAssetId, hotel_id: null, entity_type: "poi", entity_id: dest, usage_role: "hero" });
    { const rep = await pa.c.rpc("asset_usage_report", { p_asset: destAssetId }); (!rep.error && (rep.data || []).length === 1) ? ok("asset_usage_report lists the usage") : bad("usage report failed"); }
    { const r = await pa.c.from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", destAssetId).select("id"); denied(r) ? ok("archive blocked while media is in use") : bad("archive not blocked while used!"); }
    await svc.from("asset_usages").delete().eq("asset_id", destAssetId);
    { const r = await pa.c.from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", destAssetId).select("id"); (!r.error && (r.data || []).length === 1) ? ok("archive succeeds once unused") : bad("archive failed after detach"); }
    { const r = await pa.c.from("assets").update({ deleted_at: null, status: "ready" }).eq("id", destAssetId).select("id"); (!r.error && (r.data || []).length === 1) ? ok("restore returns media to library") : bad("restore failed"); }

    // 6) hotel member reads published platform + destination public media
    const hotelU = await mkUser("hotel", false);
    const hotel = (await svc.from("hotels").insert({ name: "VPMH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "editor", status: "active" });
    (((await hotelU.c.from("assets").select("id").eq("id", platId)).data || []).length === 1) ? ok("hotel member reads platform-wide media (has_any_membership)") : bad("hotel cannot read platform media");
    (((await hotelU.c.from("assets").select("id").eq("id", destAssetId)).data || []).length === 1) ? ok("hotel member reads destination media (has_destination_access)") : bad("hotel cannot read destination media");

    // 7) hotel member CANNOT write platform media
    denied(await hotelU.c.from("assets").insert({ hotel_id: null, destination_id: dest, asset_type: "poi_image", external_provider: "cdn", external_url: `https://x/${P}-hx`, display_name: `${P} hx`, status: "ready" })) ? ok("hotel member cannot create destination/platform media") : bad("hotel created platform media!");
    { const r = await hotelU.c.from("assets").update({ display_name: "hack" }).eq("id", platId).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel member cannot edit platform media") : bad("hotel edited platform media!"); }

    // 8) anon cannot read public media
    (((await anon.from("assets").select("id").eq("id", platId)).data || []).length === 0) ? ok("anon cannot read platform media") : bad("anon read platform media!");

    // 9) no hard delete (no DELETE policy) — even platform_admin cannot DELETE via PostgREST
    { const r = await pa.c.from("assets").delete().eq("id", platId).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("no hard delete (archive-only)") : bad("hard delete succeeded!"); (((await svc.from("assets").select("id").eq("id", platId)).data || []).length === 1) ? ok("row survives delete attempt") : bad("row gone after delete!"); }

    // 10) scope exclusivity CHECK: cannot own by both hotel and destination
    denied(await pa.c.from("assets").insert({ hotel_id: hotel, destination_id: dest, asset_type: "poi_image", external_provider: "cdn", external_url: `https://x/${P}-both`, display_name: `${P} both`, status: "ready" })) ? ok("scope-exclusivity blocks hotel_id + destination_id together") : bad("both-scope insert allowed!");
  } finally { await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Media verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

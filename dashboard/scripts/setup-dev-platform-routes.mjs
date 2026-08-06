// ============================================================================
// AI OLLY Dashboard — Platform CMS Routes DEV SEED (aiolly-dev only).
// ----------------------------------------------------------------------------
// Adds synthetic dev routes (with ordered POI waypoints) on a synthetic dev
// destination so a platform_admin has routes to browse/edit/publish. NEVER
// touches imported Split routes / route-to-POI relationships or Antique's
// hotel_route_settings. Idempotent (upsert by destination_id+key). The publish
// transition uses a direct postgres connection (the protect-publish trigger
// blocks a direct status→published for every role except postgres/supabase_admin
// — in the app it only happens via publish_route() with a real admin JWT).
// Keys from ../../.env.
//
//   node dashboard/scripts/setup-dev-platform-routes.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });

const body = (text) => ({ version: 1, blocks: [{ type: "paragraph", text }] });

async function publishViaPg(id) {
  const snap = (await sql.query(`update public.destination_routes set status='published', published_at=now() where id=$1 returning to_jsonb(destination_routes.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.destination_routes set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='destination_route' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at)
                   values ('destination_route',$1,$2,'published',$3,'dev seed publish',now())
                   on conflict (entity_type,entity_id,version_number) do nothing`, [id, rows[0].v, snap]);
}

async function main() {
  console.log("AI OLLY — Platform Routes dev seed (aiolly-dev)\n");
  await sql.connect();

  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik destination not found — run setup:dev-platform-destinations + setup:dev-platform-pois first."); await sql.end(); return; }
  const { data: pois } = await svc.from("destination_pois").select("id,key").eq("destination_id", dest.id).order("key");
  const byKey = Object.fromEntries((pois ?? []).map((p) => [p.key, p.id]));
  const wp = (...keys) => ({ version: 1, stops: keys.filter((k) => byKey[k]).map((k) => ({ poi_id: byKey[k], poi_key: k, note: null })) });
  console.log(`  Target destination: ${dest.name} (${(pois ?? []).length} POIs available). Split routes left untouched.`);

  const SEED = [
    { key: "dev-old-town-loop", name: "Old Town Loop (Dev)", route_type: "walking", short_description: "A gentle loop through the highlights.", body_content: body("Start at the walls, wind through the old town, finish by the sea."), difficulty: "easy", distance_km: 2.4, duration_minutes: 75, start_location: "Pile Gate", end_location: "Old Port", seasonality: "Best Apr–Oct", accessibility_info: "Mostly step-free; a few cobbled sections.", safety_notes: "Watch footing on polished stone.", source_type: "official_tourism", source_name: "Dev TB", source_url: "https://example.org/loop", verification_status: "verified", featured_default: true, waypoints: wp("dev-city-walls", "dev-rector-palace", "dev-banje-beach"), status: "published" },
    { key: "dev-coastal-ride", name: "Coastal Ride (Dev)", route_type: "cycling", short_description: "Seafront cycle (synthetic dev record).", difficulty: "moderate", distance_km: 12, duration_minutes: 60, start_location: "Banje", source_type: "manual", verification_status: "unverified", waypoints: wp("dev-banje-beach", "dev-city-walls"), status: "draft" },
  ];

  for (const r of SEED) {
    const { status, ...fields } = r;
    const { data: existing } = await svc.from("destination_routes").select("id").eq("destination_id", dest.id).eq("key", r.key).maybeSingle();
    let id = existing?.id;
    if (id) {
      await svc.from("destination_routes").update(fields).eq("id", id);
    } else {
      const { data: created, error } = await svc.from("destination_routes").insert({ ...fields, destination_id: dest.id, status: "draft" }).select("id").single();
      if (error) { console.log(`  ✗ ${r.key}: ${error.message}`); continue; }
      id = created.id;
    }
    if (status === "published") await publishViaPg(id);
    else await sql.query(`update public.destination_routes set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻ updated" : "＋ created"} ${r.key} (${status}, ${r.waypoints.stops.length} stops)`);
  }

  const { count } = await svc.from("destination_routes").select("id", { count: "exact", head: true }).eq("destination_id", dest.id);
  console.log(`\n  Done. ${count} routes in ${dest.name}.`);
  await sql.end();
}

main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

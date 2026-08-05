// ============================================================================
// AI OLLY Dashboard — Platform CMS POIs DEV SEED (aiolly-dev only).
// ----------------------------------------------------------------------------
// Adds a few SYNTHETIC dev POIs to a synthetic dev destination so a platform_admin
// has POIs to browse/edit/publish. NEVER touches imported Split POIs or Antique's
// hotel_poi_settings. Idempotent (upsert by destination_id+key). The publish
// transition uses a direct postgres connection (the protect-publish trigger blocks
// a direct status→published for every role except postgres/supabase_admin — in the
// app it only happens via publish_poi() with a real admin JWT). Keys from ../../.env.
//
//   node dashboard/scripts/setup-dev-platform-pois.mjs
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

// Attached to the synthetic "Dubrovnik (Dev)" destination (created by the
// destinations dev seed). Never the real Split destination.
const SEED = [
  { key: "dev-city-walls", name: "City Walls (Dev)", category: "landmark", short_description: "Walk the 1940m medieval walls.", body_content: body("The best-preserved fortifications in the Mediterranean, ~1940m around the Old Town."), latitude: 42.6414, longitude: 18.1075, address: "Old Town, Dubrovnik", website: "https://example.org/walls", opening_info: "08:00–19:30 (summer)", price_info: "€35 adult", recommended_duration_minutes: 90, source_type: "official_tourism", source_name: "Dubrovnik TB (dev)", source_url: "https://example.org/walls", verification_status: "verified", featured_default: true, status: "published" },
  { key: "dev-rector-palace", name: "Rector’s Palace (Dev)", category: "museum", short_description: "Gothic-Renaissance palace museum.", body_content: body("Former seat of the Rector of the Republic of Ragusa; now the Cultural History Museum."), latitude: 42.6402, longitude: 18.1108, address: "Pred Dvorom 3", opening_info: "09:00–18:00", price_info: "€15", recommended_duration_minutes: 45, source_type: "manual", verification_status: "unverified", status: "draft" },
  { key: "dev-banje-beach", name: "Banje Beach (Dev)", category: "beach", short_description: "Pebble beach east of the Old Town.", latitude: 42.6419, longitude: 18.1156, address: "Frana Supila", source_type: "partner", source_name: "Dev DMC", source_url: "https://example.org/banje", verification_status: "stale", status: "published" },
];

async function publishViaPg(id) {
  const snap = (await sql.query(`update public.destination_pois set status='published', published_at=now() where id=$1 returning to_jsonb(destination_pois.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.destination_pois set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='destination_poi' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at)
                   values ('destination_poi',$1,$2,'published',$3,'dev seed publish',now())
                   on conflict (entity_type,entity_id,version_number) do nothing`, [id, rows[0].v, snap]);
}

async function main() {
  console.log("AI OLLY — Platform POIs dev seed (aiolly-dev)\n");
  await sql.connect();

  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik destination not found — run setup:dev-platform-destinations first."); await sql.end(); return; }
  console.log(`  Target destination: ${dest.name} (${dest.id}). Split POIs left untouched.`);

  for (const p of SEED) {
    const { status, ...fields } = p;
    const { data: existing } = await svc.from("destination_pois").select("id").eq("destination_id", dest.id).eq("key", p.key).maybeSingle();
    let id = existing?.id;
    if (id) {
      await svc.from("destination_pois").update(fields).eq("id", id);
    } else {
      const { data: created, error } = await svc.from("destination_pois").insert({ ...fields, destination_id: dest.id, status: "draft" }).select("id").single();
      if (error) { console.log(`  ✗ ${p.key}: ${error.message}`); continue; }
      id = created.id;
    }
    if (status === "published") await publishViaPg(id);
    else await sql.query(`update public.destination_pois set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻ updated" : "＋ created"} ${p.key} (${status})`);
  }

  const { count } = await svc.from("destination_pois").select("id", { count: "exact", head: true }).eq("destination_id", dest.id);
  console.log(`\n  Done. ${count} POIs in ${dest.name}.`);
  await sql.end();
}

main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

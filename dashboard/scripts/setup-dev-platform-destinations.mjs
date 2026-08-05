// ============================================================================
// AI OLLY Dashboard — Platform CMS Destinations DEV SEED (aiolly-dev only).
// ----------------------------------------------------------------------------
// Adds a few SYNTHETIC dev destinations so a platform_admin has content to browse
// in the Destinations module (list/filter/search/publish/archive). Idempotent
// (upsert by slug). NEVER touches the real Split / Split (Dev) rows or any hotel
// linkage — Antique Split stays linked to Split untouched.
//
// Field upserts go through the service-role client. The publish transition
// (status→published + live snapshot + a content_versions row) is done over a
// direct postgres connection, because the protect-publish trigger deliberately
// blocks a direct status→published for every role except postgres/supabase_admin
// (in the app it only happens via publish_destination() with a real admin JWT).
// Reads keys from ../../.env.
//
//   node dashboard/scripts/setup-dev-platform-destinations.mjs
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

// Synthetic dev destinations — clearly marked "(Dev)" and never linked to hotels.
const SEED = [
  { slug: "dev-dubrovnik", name: "Dubrovnik (Dev)", country_code: "HR", region: "Dalmatia", destination_type: "city", timezone: "Europe/Zagreb", default_locale: "en", supported_locales: ["en", "hr", "de"], latitude: 42.6507, longitude: 18.0944, short_description: "Walled Adriatic city (synthetic dev record).", seo_title: "Dubrovnik — Old Town & Walls", seo_description: "Dev destination for CMS testing.", source_type: "official_tourism", source_name: "Dubrovnik Tourist Board (dev)", source_url: "https://example.org/dubrovnik", verification_status: "verified", status: "published" },
  { slug: "dev-hvar", name: "Hvar (Dev)", country_code: "HR", region: "Dalmatia", destination_type: "island", timezone: "Europe/Zagreb", default_locale: "en", supported_locales: ["en", "hr"], latitude: 43.1729, longitude: 16.4411, short_description: "Sunny Adriatic island (synthetic dev record).", source_type: "manual", verification_status: "unverified", status: "draft" },
  { slug: "dev-istria", name: "Istria (Dev)", country_code: "HR", region: "Istria", destination_type: "tourism_region", timezone: "Europe/Zagreb", default_locale: "en", supported_locales: ["en", "hr", "it"], latitude: 45.2333, longitude: 13.9, short_description: "Peninsula region (synthetic dev record).", source_type: "partner", source_name: "Istria DMC (dev)", source_url: "https://example.org/istria", verification_status: "stale", status: "published" },
];

async function publishViaPg(id) {
  // postgres role bypasses protect_destination_row_publish (as publish_destination() does).
  const snap = (await sql.query(`update public.destinations set status='published', published_at=now() where id=$1 returning to_jsonb(destinations.*) - 'published_snapshot' as s`, [id])).rows[0].s;
  await sql.query(`update public.destinations set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='destination' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at)
                   values ('destination',$1,$2,'published',$3,'dev seed publish',now())
                   on conflict (entity_type,entity_id,version_number) do nothing`, [id, rows[0].v, snap]);
}

async function main() {
  console.log("AI OLLY — Platform Destinations dev seed (aiolly-dev)\n");
  await sql.connect();

  const { data: split } = await svc.from("destinations").select("slug,status").in("slug", ["split", "dash-split"]);
  console.log(`  Real destinations present: ${(split ?? []).map((s) => `${s.slug}(${s.status})`).join(", ") || "none"} — left untouched.`);

  for (const d of SEED) {
    const { status, ...fields } = d;
    const { data: existing } = await svc.from("destinations").select("id").eq("slug", d.slug).maybeSingle();
    let id = existing?.id;
    if (id) {
      await svc.from("destinations").update(fields).eq("id", id);
    } else {
      const { data: created, error } = await svc.from("destinations").insert({ ...fields, status: "draft" }).select("id").single();
      if (error) { console.log(`  ✗ ${d.slug}: ${error.message}`); continue; }
      id = created.id;
    }
    if (status === "published") await publishViaPg(id);
    else await sql.query(`update public.destinations set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻ updated" : "＋ created"} ${d.slug} (${status})`);
  }

  const { count } = await svc.from("destinations").select("id", { count: "exact", head: true });
  console.log(`\n  Done. ${count} destinations total in aiolly-dev.`);
  await sql.end();
}

main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

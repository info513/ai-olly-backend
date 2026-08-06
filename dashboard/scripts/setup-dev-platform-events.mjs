// AI OLLY — Platform CMS Events DEV SEED (aiolly-dev only). Synthetic events on a
// dev destination; imported Split events + Antique hotel_event_settings untouched.
// Idempotent. Publishes via a postgres connection. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
const body = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const SEED = [
  { key: "dev-summer-festival", title: "Summer Festival (Dev)", short_description: "Music on the waterfront.", body_content: body("Synthetic dev event on the promenade."), location_name: "Old Port", starts_at: inDays(14), ends_at: inDays(16), all_day: false, verification_status: "verified", featured_default: true, status: "published" },
  { key: "dev-market-day", title: "Market Day (Dev)", short_description: "Weekly farmers market.", location_name: "Central Square", starts_at: inDays(3), ends_at: inDays(3), all_day: true, recurrence: "weekly", status: "published" },
  { key: "dev-past-fair", title: "Winter Fair (Dev)", short_description: "Already ended.", location_name: "Square", starts_at: inDays(-30), ends_at: inDays(-28), all_day: false, status: "published" },
  { key: "dev-draft-concert", title: "Concert (Dev)", short_description: "Draft event.", status: "draft" },
];
async function publishViaPg(id) {
  const snap = (await sql.query(`update public.destination_events set status='published', published_at=now() where id=$1 returning to_jsonb(destination_events.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.destination_events set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='destination_event' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at) values ('destination_event',$1,$2,'published',$3,'dev seed publish',now()) on conflict do nothing`, [id, rows[0].v, snap]);
}
async function main() {
  console.log("AI OLLY — Platform Events dev seed\n"); await sql.connect();
  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik not found — run setup:dev-platform-destinations first."); await sql.end(); return; }
  console.log(`  Target: ${dest.name}. Split events untouched.`);
  for (const e of SEED) {
    const { status, ...fields } = e;
    const { data: existing } = await svc.from("destination_events").select("id").eq("destination_id", dest.id).eq("key", e.key).maybeSingle();
    let id = existing?.id;
    if (id) await svc.from("destination_events").update(fields).eq("id", id);
    else { const { data: c, error } = await svc.from("destination_events").insert({ ...fields, destination_id: dest.id, status: "draft" }).select("id").single(); if (error) { console.log(`  ✗ ${e.key}: ${error.message}`); continue; } id = c.id; }
    if (status === "published") await publishViaPg(id); else await sql.query(`update public.destination_events set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻" : "＋"} ${e.key} (${status})`);
  }
  const { count } = await svc.from("destination_events").select("id", { count: "exact", head: true }).eq("destination_id", dest.id);
  console.log(`\n  Done. ${count} events in ${dest.name}.`); await sql.end();
}
main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

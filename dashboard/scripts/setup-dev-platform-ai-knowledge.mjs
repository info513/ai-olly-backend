// AI OLLY — Platform CMS Destination AI Knowledge DEV SEED (aiolly-dev only).
// Synthetic destination-scope knowledge articles (hotel_id null, source_type
// 'destination') + aliases on a dev destination. Imported Split knowledge untouched.
// Publishes via a postgres connection. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
const SEED = [
  { key: "dev-airport-transfer", title: "Getting from the airport (Dev)", approved_answer: "The airport bus runs every 30 minutes to the main station; a taxi is ~€30.", available_to_ai: true, priority: 10, is_critical: false, aliases: ["airport", "how to get to town", "transfer from airport"], status: "published" },
  { key: "dev-emergency-numbers", title: "Emergency numbers (Dev)", approved_answer: "Emergency: 112. Police: 192. Ambulance: 194.", available_to_ai: true, priority: 100, is_critical: true, aliases: ["emergency", "police", "ambulance"], status: "published" },
  { key: "dev-tap-water", title: "Is tap water safe? (Dev)", approved_answer: "Yes, tap water is safe to drink here.", available_to_ai: true, priority: 5, is_critical: false, aliases: ["drinking water", "tap water"], status: "draft" },
];
async function publishViaPg(id) {
  const snap = (await sql.query(`update public.knowledge_articles set status='published', published_at=now() where id=$1 returning to_jsonb(knowledge_articles.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.knowledge_articles set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='knowledge_article' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at) values ('knowledge_article',$1,$2,'published',$3,'dev seed publish',now()) on conflict do nothing`, [id, rows[0].v, snap]);
}
async function main() {
  console.log("AI OLLY — Platform Destination AI dev seed\n"); await sql.connect();
  const { data: dest } = await svc.from("destinations").select("id,name,default_locale").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik not found — run setup:dev-platform-destinations first."); await sql.end(); return; }
  console.log(`  Target: ${dest.name}. Split knowledge untouched.`);
  for (const a of SEED) {
    const { status, aliases, ...fields } = a;
    const { data: existing } = await svc.from("knowledge_articles").select("id").eq("destination_id", dest.id).is("hotel_id", null).eq("key", a.key).maybeSingle();
    let id = existing?.id;
    if (id) await svc.from("knowledge_articles").update(fields).eq("id", id);
    else { const { data: c, error } = await svc.from("knowledge_articles").insert({ ...fields, destination_id: dest.id, hotel_id: null, source_type: "destination", locale: dest.default_locale, status: "draft" }).select("id").single(); if (error) { console.log(`  ✗ ${a.key}: ${error.message}`); continue; } id = c.id; }
    // aliases (idempotent)
    for (const al of aliases) { const { data: ex } = await svc.from("knowledge_aliases").select("id").eq("article_id", id).eq("alias_text", al).maybeSingle(); if (!ex) await svc.from("knowledge_aliases").insert({ article_id: id, hotel_id: null, alias_text: al, locale: dest.default_locale, active: true }); }
    if (status === "published") await publishViaPg(id); else await sql.query(`update public.knowledge_articles set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻" : "＋"} ${a.key} (${status}, ${aliases.length} aliases)`);
  }
  const { count } = await svc.from("knowledge_articles").select("id", { count: "exact", head: true }).eq("destination_id", dest.id).is("hotel_id", null);
  console.log(`\n  Done. ${count} destination knowledge articles in ${dest.name}.`); await sql.end();
}
main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

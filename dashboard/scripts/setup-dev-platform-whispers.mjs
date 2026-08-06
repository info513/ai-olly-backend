// AI OLLY — Platform CMS Whispers DEV SEED (aiolly-dev only). Synthetic whispers on
// a dev destination; imported Split whispers + Antique hotel_whisper_settings untouched.
// Idempotent. Publishes via a postgres connection (protect-publish blocks direct
// status→published for non-superusers). Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
const body = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });
const SEED = [
  { channel_key: "dev-legends", key: "dev-ch01", title: "The Founding (Dev)", short_description: "How the town began.", body_content: body("A synthetic dev chapter about the founding of the town."), verification_status: "verified", featured_default: true, status: "published" },
  { channel_key: "dev-legends", key: "dev-ch02", title: "The Sea Trade (Dev)", short_description: "Merchants and the harbour.", body_content: body("A synthetic dev chapter about the sea trade."), status: "published" },
  { channel_key: "dev-legends", key: "dev-ch03", title: "The Modern Era (Dev)", short_description: "Draft chapter.", status: "draft" },
];
async function publishViaPg(id) {
  const snap = (await sql.query(`update public.destination_whispers set status='published', published_at=now() where id=$1 returning to_jsonb(destination_whispers.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.destination_whispers set published_snapshot=$2 where id=$1`, [id, snap]);
  const { rows } = await sql.query(`select coalesce(max(version_number),0)+1 v from public.content_versions where entity_type='destination_whisper' and entity_id=$1`, [id]);
  await sql.query(`insert into public.content_versions (entity_type,entity_id,version_number,status,snapshot,change_summary,published_at) values ('destination_whisper',$1,$2,'published',$3,'dev seed publish',now()) on conflict do nothing`, [id, rows[0].v, snap]);
}
async function main() {
  console.log("AI OLLY — Platform Whispers dev seed\n"); await sql.connect();
  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik not found — run setup:dev-platform-destinations first."); await sql.end(); return; }
  console.log(`  Target: ${dest.name}. Split whispers untouched.`);
  for (const w of SEED) {
    const { status, ...fields } = w;
    const { data: existing } = await svc.from("destination_whispers").select("id").eq("destination_id", dest.id).eq("key", w.key).maybeSingle();
    let id = existing?.id;
    if (id) await svc.from("destination_whispers").update(fields).eq("id", id);
    else { const { data: c, error } = await svc.from("destination_whispers").insert({ ...fields, destination_id: dest.id, status: "draft" }).select("id").single(); if (error) { console.log(`  ✗ ${w.key}: ${error.message}`); continue; } id = c.id; }
    if (status === "published") await publishViaPg(id); else await sql.query(`update public.destination_whispers set status='draft' where id=$1 and status<>'published'`, [id]);
    console.log(`  ${existing ? "↻" : "＋"} ${w.key} (${status})`);
  }
  const { count } = await svc.from("destination_whispers").select("id", { count: "exact", head: true }).eq("destination_id", dest.id);
  console.log(`\n  Done. ${count} whispers in ${dest.name}.`); await sql.end();
}
main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });

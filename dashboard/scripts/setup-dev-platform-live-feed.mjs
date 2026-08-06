// AI OLLY — Platform CMS Live Feed DEV SEED (aiolly-dev only). Imports synthetic
// feed items (destination_events with is_live_feed=true) on a dev destination.
// Idempotent (dedup by feed_dedup_key). Split events untouched. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const dedup = (t, s) => `${t.toLowerCase().trim().replace(/\s+/g, " ")}|${s ? new Date(s).toISOString().slice(0, 10) : "nodate"}`.slice(0, 200);
const SEED = [
  { title: "Street Food Night (Dev)", feed_source: "City events feed", starts_at: inDays(2), ends_at: inDays(2), all_day: false, location_name: "Riva" },
  { title: "Open Air Cinema (Dev)", feed_source: "City events feed", starts_at: inDays(5), ends_at: inDays(5), all_day: false, location_name: "Fort" },
  { title: "Past Flea Market (Dev)", feed_source: "Partner feed", starts_at: inDays(-10), ends_at: inDays(-10), all_day: true, location_name: "Square" },
];
async function main() {
  console.log("AI OLLY — Platform Live Feed dev seed\n");
  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik not found — run setup:dev-platform-destinations first."); return; }
  console.log(`  Target: ${dest.name}.`);
  for (const [i, e] of SEED.entries()) {
    const key = dedup(e.title, e.starts_at);
    const { data: existing } = await svc.from("destination_events").select("id").eq("destination_id", dest.id).eq("feed_dedup_key", key).maybeSingle();
    if (existing) { console.log(`  = ${e.title} (already imported)`); continue; }
    const { error } = await svc.from("destination_events").insert({ destination_id: dest.id, key: `feed-dev-${i}-${Date.now().toString(36)}`, title: e.title, feed_source: e.feed_source, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, location_name: e.location_name, is_live_feed: true, source_type: "city_event_feed", feed_dedup_key: key, feed_imported_at: new Date().toISOString(), status: "draft" });
    console.log(error ? `  ✗ ${e.title}: ${error.message}` : `  ＋ ${e.title}`);
  }
  const { count } = await svc.from("destination_events").select("id", { count: "exact", head: true }).eq("destination_id", dest.id).eq("is_live_feed", true);
  console.log(`\n  Done. ${count} live-feed items in ${dest.name}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

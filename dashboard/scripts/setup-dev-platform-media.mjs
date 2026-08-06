// AI OLLY — Platform CMS Media DEV SEED (aiolly-dev only).
// Synthetic platform- and destination-owned public media (assets with hotel_id
// IS NULL → owner_scope 'platform' | 'destination'). Uses EXTERNAL references so
// the seed needs no storage upload. Idempotent by (hotel_id null, external_url).
// Imported Split/hotel assets are untouched. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function upsertExternal(a) {
  const { data: ex } = await svc.from("assets").select("id").is("hotel_id", null).eq("external_url", a.external_url).maybeSingle();
  if (ex) { await svc.from("assets").update(a).eq("id", ex.id); return { id: ex.id, created: false }; }
  const { data, error } = await svc.from("assets").insert(a).select("id").single();
  if (error) throw error;
  return { id: data.id, created: true };
}

async function main() {
  console.log("AI OLLY — Platform Media dev seed\n");
  const { data: dest } = await svc.from("destinations").select("id,name").eq("slug", "dev-dubrovnik").maybeSingle();
  if (!dest) { console.log("  dev-dubrovnik not found — run setup:dev-platform-destinations first."); return; }
  console.log(`  Destination: ${dest.name}. Imported/hotel assets untouched.\n`);

  const SEED = [
    // platform-wide (hotel_id null, destination_id null)
    { hotel_id: null, destination_id: null, asset_type: "short_video", external_provider: "vimeo", external_url: "https://vimeo.com/aiolly-dev/platform-intro", external_id: "plat-intro", display_name: "AI OLLY platform intro (Dev)", caption: "Shared brand intro loop", source_credit: "AI OLLY", rights_owner: "AI OLLY", license_type: "all-rights-reserved", status: "ready" },
    // destination-owned (destination_id set, hotel_id null)
    { hotel_id: null, destination_id: dest.id, asset_type: "short_video", external_provider: "youtube", external_url: "https://youtube.com/watch?v=dev-dubrovnik-walls", external_id: "dbv-walls", display_name: "City walls flythrough (Dev)", caption: "Aerial of the old town walls", source_credit: "Dubrovnik Tourist Board", rights_owner: "Dubrovnik Tourist Board", license_type: "cc-by", status: "ready" },
    { hotel_id: null, destination_id: dest.id, asset_type: "short_video", external_provider: "cdn", external_url: "https://cdn.aiolly.dev/dev/dubrovnik-harbour.mp4", external_id: "dbv-harbour", display_name: "Old harbour at dusk (Dev)", caption: "Golden-hour harbour clip", source_credit: "AI OLLY", rights_owner: "AI OLLY", license_type: "all-rights-reserved", status: "ready" },
  ];

  for (const a of SEED) {
    const { id, created } = await upsertExternal(a);
    const scope = a.destination_id ? "destination" : "platform";
    console.log(`  ${created ? "＋" : "↻"} ${a.display_name} [${scope}] (${id.slice(0, 8)}…)`);
  }
  const { count } = await svc.from("assets").select("id", { count: "exact", head: true }).is("hotel_id", null).is("deleted_at", null);
  console.log(`\n  Done. ${count} platform/destination-owned media (hotel_id null) in aiolly-dev.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

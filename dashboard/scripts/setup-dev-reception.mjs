// ============================================================================
// AI OLLY Dashboard — DEV Reception seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Synthetic Demo Hotel operational data for Sprint 5: guests (arriving /
// in-house / departing / previous / duplicate), stays, a published + draft
// consent template, a signed consent + a consent-missing stay, a duplicate
// suggestion, requests (new / in-progress / resolved / urgent-overdue) with an
// internal note + guest reply, and feedback (incl. follow-up). Idempotent via
// external_source='dev-seed' + source markers. Reserved/non-real domains only.
// NO Antique Split production content or real guests.
//
//   node dashboard/scripts/setup-dev-reception.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const SRC = "dev-seed";
const iso = (d) => d.toISOString();
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d; };
const at = (n, h = 14) => { const d = day(n); d.setUTCHours(h, 0, 0, 0); return iso(d); };

async function main() {
  console.log("AI OLLY reception seed →", readEnv("SUPABASE_URL"), "\n");
  const { data: hotel } = await svc.from("hotels").select("id").eq("slug", "dash-demo-hotel").single();
  if (!hotel) throw new Error("run setup-dev-user.mjs first");
  const H = hotel.id;
  const { data: rooms } = await svc.from("rooms").select("id,room_number").eq("hotel_id", H).order("room_number");
  const room = (n) => rooms.find((r) => r.room_number === n)?.id ?? null;

  // ── guests (idempotent by external_source/external_id) ──────────────────────
  const upGuest = async (extId, row) => {
    const f = await svc.from("guests").select("id").eq("hotel_id", H).eq("external_source", SRC).eq("external_id", extId).maybeSingle();
    if (f.data?.id) { await svc.from("guests").update(row).eq("id", f.data.id); return f.data.id; }
    const r = await svc.from("guests").insert({ hotel_id: H, external_source: SRC, external_id: extId, ...row }).select("id").single();
    if (r.error) throw new Error(`guest ${extId}: ${r.error.message}`); return r.data.id;
  };
  const gAlice = await upGuest("g-alice", { first_name: "Alice", last_name: "Andersen", email: "alice.andersen@example.com", phone: "+15550100201", preferred_locale: "en", country_code: "US" });
  const gBruno = await upGuest("g-bruno", { first_name: "Bruno", last_name: "Bianchi", email: "bruno.bianchi@example.net", phone: "+390550100202", preferred_locale: "it", country_code: "IT" });
  const gClara = await upGuest("g-clara", { first_name: "Clara", last_name: "Costa", email: "clara.costa@example.org", preferred_locale: "en", country_code: "PT" });
  const gDora = await upGuest("g-dora", { first_name: "Dora", last_name: "Dujmovic", preferred_locale: "hr", country_code: "HR" });
  const gEwan = await upGuest("g-ewan", { first_name: "Ewan", last_name: "Edwards", email: "ewan.edwards@example.com", preferred_locale: "en", country_code: "GB" });
  const gAlice2 = await upGuest("g-alice2", { first_name: "Alice", last_name: "Andersen", email: "a.andersen@example.co", preferred_locale: "en", country_code: "US" });

  // ── duplicate suggestion (alice vs alice2) ──────────────────────────────────
  {
    const f = await svc.from("guest_duplicate_suggestions").select("id").eq("hotel_id", H).eq("guest_id", gAlice).eq("candidate_guest_id", gAlice2).maybeSingle();
    if (!f.data) await svc.from("guest_duplicate_suggestions").insert({ hotel_id: H, guest_id: gAlice, candidate_guest_id: gAlice2, match_reason: "Same full name; similar email", match_score: 0.9, status: "pending" });
  }

  // ── stays (idempotent by external_source/external_id) ───────────────────────
  const upStay = async (extId, row) => {
    const f = await svc.from("stays").select("id").eq("hotel_id", H).eq("external_source", SRC).eq("external_id", extId).maybeSingle();
    if (f.data?.id) { await svc.from("stays").update(row).eq("id", f.data.id); return f.data.id; }
    const r = await svc.from("stays").insert({ hotel_id: H, external_source: SRC, external_id: extId, ...row }).select("id").single();
    if (r.error) throw new Error(`stay ${extId}: ${r.error.message}`); return r.data.id;
  };
  const sAlice = await upStay("s-alice", { guest_id: gAlice, room_id: room("101"), status: "reserved", arrival_at: at(0, 15), departure_at: at(2, 10) });
  const sBruno = await upStay("s-bruno", { guest_id: gBruno, room_id: room("102"), status: "checked_in", arrival_at: at(-1, 15), departure_at: at(1, 10), checked_in_at: at(-1, 15) });
  const sClara = await upStay("s-clara", { guest_id: gClara, room_id: room("103"), status: "checked_in", arrival_at: at(-2, 15), departure_at: at(0, 10), checked_in_at: at(-2, 15) });
  const sDora  = await upStay("s-dora",  { guest_id: gDora,  room_id: room("201"), status: "checked_out", arrival_at: at(-5, 15), departure_at: at(-3, 10), checked_in_at: at(-5, 15), checked_out_at: at(-3, 10) });
  const sEwan  = await upStay("s-ewan",  { guest_id: gEwan,  room_id: room("202"), status: "checked_in", arrival_at: at(-1, 15), departure_at: at(2, 10), checked_in_at: at(-1, 15) });

  // ── consent templates: published v1 + draft v2 (synthetic text only) ────────
  const upTemplate = async (version, row) => {
    const f = await svc.from("consent_templates").select("id").eq("hotel_id", H).eq("key", "gdpr-data").eq("locale", "en").eq("version", version).maybeSingle();
    if (f.data?.id) { await svc.from("consent_templates").update(row).eq("id", f.data.id); return f.data.id; }
    const r = await svc.from("consent_templates").insert({ hotel_id: H, key: "gdpr-data", locale: "en", version, ...row }).select("id").single();
    if (r.error) throw new Error(`template v${version}: ${r.error.message}`); return r.data.id;
  };
  const V1_TEXT = "[SYNTHETIC — dev only] I agree that Demo Hotel may process my personal data (name, contact details, stay information) to manage my stay and provide guest services. I understand I can withdraw this consent at any time.";
  const t1 = await upTemplate(1, { title: "Data processing consent", body_text: V1_TEXT, status: "published", active: true, published_at: at(-10) });
  await upTemplate(2, { title: "Data processing consent", body_text: V1_TEXT + " Updated (draft): marketing preferences may be set separately.", status: "draft", active: true });

  // ── signed consent for Bruno (direct insert mirrors sign_consent output) ────
  {
    const f = await svc.from("consents").select("id").eq("hotel_id", H).eq("guest_id", gBruno).eq("template_id", t1).maybeSingle();
    if (!f.data) await svc.from("consents").insert({ hotel_id: H, guest_id: gBruno, stay_id: sBruno, template_id: t1, consent_type: "gdpr-data", consent_version: 1, locale: "en", consent_text_snapshot: V1_TEXT, signed_name: "Bruno Bianchi", signed_at: at(-1, 15), status: "granted" });
  }
  // Clara + Ewan intentionally have NO consent (consent-missing examples).

  // ── requests (idempotent by source marker) ──────────────────────────────────
  const upRequest = async (mark, row, events = []) => {
    const source = `${SRC}:${mark}`;
    const f = await svc.from("guest_requests").select("id").eq("hotel_id", H).eq("source", source).maybeSingle();
    let id = f.data?.id;
    if (id) { await svc.from("guest_requests").update(row).eq("id", id); }
    else { const r = await svc.from("guest_requests").insert({ hotel_id: H, source, ...row }).select("id").single(); if (r.error) throw new Error(`request ${mark}: ${r.error.message}`); id = r.data.id; }
    for (const e of events) {
      const ef = await svc.from("request_events").select("id").eq("request_id", id).eq("event_type", e.event_type).eq("note", e.note).maybeSingle();
      if (!ef.data) await svc.from("request_events").insert({ request_id: id, hotel_id: H, ...e });
    }
    return id;
  };
  await upRequest("towels", { stay_id: sBruno, room_id: room("102"), guest_id: gBruno, request_type: "housekeeping", title: "Extra towels, please", description: "Two extra bath towels for room 102.", priority: "normal", status: "new" });
  await upRequest("ac", { stay_id: sEwan, room_id: room("202"), guest_id: gEwan, request_type: "maintenance", title: "AC not cooling", description: "Air conditioning in 202 is not cooling.", priority: "high", status: "in_progress" },
    [{ event_type: "internal_note", note: "Maintenance notified; ETA 30 min.", is_internal: true }, { event_type: "assigned", note: "Assigned to duty manager", is_internal: true }]);
  await upRequest("checkout", { stay_id: sClara, room_id: room("103"), guest_id: gClara, request_type: "front_desk", title: "Late checkout possible?", description: "Guest asks for 2pm checkout.", priority: "normal", status: "resolved", acknowledged_at: at(0, 8), resolved_at: at(0, 9), guest_visible_response: "Late checkout until 14:00 is confirmed — enjoy your morning!" },
    [{ event_type: "guest_reply", note: "Late checkout until 14:00 is confirmed — enjoy your morning!", is_internal: false }]);
  await upRequest("urgent", { stay_id: sBruno, room_id: room("102"), guest_id: gBruno, request_type: "front_desk", title: "Guest locked out of room", description: "Key card not working.", priority: "urgent", status: "new", created_at: new Date(Date.now() - 3 * 3.6e6).toISOString() });

  // ── feedback ─────────────────────────────────────────────────────────────────
  const upFeedback = async (mark, row) => {
    const source = `${SRC}:${mark}`;
    const f = await svc.from("feedback").select("id").eq("hotel_id", H).eq("source", source).maybeSingle();
    if (f.data?.id) { await svc.from("feedback").update(row).eq("id", f.data.id); return f.data.id; }
    const r = await svc.from("feedback").insert({ hotel_id: H, source, ...row }).select("id").single();
    if (r.error) throw new Error(`feedback ${mark}: ${r.error.message}`); return r.data.id;
  };
  await upFeedback("praise", { stay_id: sDora, room_id: room("201"), rating: 5, category: "Staff", message: "Reception was wonderful — thank you!", follow_up_requested: false, status: "new" });
  await upFeedback("cleanliness", { stay_id: sClara, room_id: room("103"), rating: 2, category: "Room cleanliness", message: "Bathroom wasn't ready at check-in.", follow_up_requested: true, status: "new" });

  console.log("  ✓ 6 guests (incl. duplicate), 5 stays (arriving/in-house/departing/previous/consent-missing)");
  console.log("  ✓ consent template published v1 + draft v2, 1 signed consent, 2 consent-missing stays");
  console.log("  ✓ 1 duplicate suggestion, 4 requests (new/in-progress+note/resolved+reply/urgent-overdue), 2 feedback");
  console.log("\n  Done. Open Reception / Guests / Stays / Consent.\n");
}
main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });

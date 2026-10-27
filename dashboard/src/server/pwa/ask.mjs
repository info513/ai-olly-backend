// ============================================================================
// Guest "Ask Dioclea" brain (Session 4). Replaces the old Express GPT path with
// Claude (Anthropic). Grounds the model in THIS hotel's live Supabase data and
// enforces the safe-handoff policy: hotel-specific facts answered ONLY from the
// provided data (else hand off to reception); city/general questions may use
// general knowledge, briefly. Answers in the guest's own language. Response shape
// matches the old endpoint: { ok, answer }. Server-only.
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";
import { sb, authGuest } from "./guest.mjs";

const MODEL = "claude-haiku-5-5"; // fast + inexpensive — right tier for concierge Q&A
const blocks = (bc) => (!bc ? "" : typeof bc === "string" ? bc : (Array.isArray(bc) ? bc : bc.blocks || []).map((b) => (b && (b.text ?? b.content ?? "")) || "").filter(Boolean).join(" "));
const arr = (v) => (Array.isArray(v) ? v.join(", ") : v || "");

/** Assemble a compact, hotel-scoped grounding context from live Supabase data. */
async function buildContext(client, ctx) {
  const { hotel, room, roomType: rt } = ctx;
  const s = hotel.settings || {};
  const svc = (await client.rpc("resolved_hotel_services", { p_hotel: hotel.id })).data || [];
  const pois = (await client.rpc("resolved_destination_pois", { p_hotel: hotel.id })).data || [];
  const lines = [];
  lines.push(`HOTEL: ${hotel.name}`);
  const contact = [
    hotel.reception_phone && `reception phone ${hotel.reception_phone}`,
    s.emergency_number && `emergency ${s.emergency_number}`,
    s.medical_number && `medical ${s.medical_number}`,
    hotel.check_in_time && `check-in ${hotel.check_in_time}`, hotel.check_out_time && `check-out ${hotel.check_out_time}`,
  ].filter(Boolean).join(", ");
  if (contact) lines.push(`HOTEL CONTACT/TIMES: ${contact}`);
  lines.push(`\nGUEST ROOM: ${room.room_number} (${rt?.name ?? ""})`);
  const rg = [
    rt?.wifi_instructions && `WiFi: ${rt.wifi_instructions}`,
    (room.air_conditioning_note_override ?? rt?.ac_instructions) && `AC: ${room.air_conditioning_note_override ?? rt.ac_instructions}`,
    rt?.tv_instructions && `TV: ${rt.tv_instructions}`,
    rt?.safe_instructions && `Safe: ${rt.safe_instructions}`,
    (room.smart_glass_instructions_override ?? rt?.smart_glass_instructions) && `Smart glass: ${room.smart_glass_instructions_override ?? rt.smart_glass_instructions}`,
    arr(room.room_features_override ?? rt?.room_features) && `Features: ${arr(room.room_features_override ?? rt?.room_features)}`,
  ].filter(Boolean);
  if (rg.length) lines.push("ROOM GUIDE:\n" + rg.join("\n"));
  if (svc.length) lines.push("\nHOTEL SERVICES (name — detail):\n" + svc.filter((x) => x.visible_in_pwa)
    .map((x) => `- ${x.title}: ${x.short_description || blocks(x.body_content)}`.slice(0, 300)).join("\n"));
  if (pois.length) lines.push("\nNEARBY (Split, curated):\n" + pois.slice(0, 18)
    .map((p) => `- ${p.name}${p.walking_time_minutes != null ? ` (${p.walking_time_minutes} min walk)` : ""}: ${p.short_description || ""}`.slice(0, 200)).join("\n"));
  return { context: lines.join("\n"), receptionPhone: hotel.reception_phone || "" };
}

function systemPrompt(hotelName, receptionPhone, context) {
  return `You are Dioclea, the warm, concise AI concierge for ${hotelName} (a hotel in Split, Croatia).

RULES:
- Answer in the SAME LANGUAGE as the guest's question.
- For HOTEL-SPECIFIC facts (services, amenities, room, WiFi, hours, policies, prices), use ONLY the HOTEL DATA below. If the answer is not in the data, do NOT guess — briefly say you'll connect them with reception${receptionPhone ? ` (${receptionPhone})` : ""}.
- For general Split / city / travel questions you MAY use general knowledge, but keep it brief and suggest confirming details locally.
- Never invent prices, hours, phone numbers, or policies.
- Be friendly and short (2–4 sentences). Write in PLAIN TEXT only — no markdown, no asterisks, no headings.

=== HOTEL DATA ===
${context}
=== END HOTEL DATA ===`;
}

/** POST /api/pwa-ask → { ok, answer }. Always returns a usable answer (graceful handoff on error). */
export async function ask({ slug, room, token, question }) {
  if (!room) return { status: 400, body: { ok: false, error: "Missing room" } };
  if (!question || !String(question).trim()) return { status: 400, body: { ok: false, error: "Missing question" } };
  const client = sb();
  const ctx = await authGuest(client, slug, room, token);
  if (!ctx) return { status: 403, body: { ok: false, error: "Access denied" } };

  const { context, receptionPhone } = await buildContext(client, ctx);
  const handoff = receptionPhone
    ? `I'm not certain about that — our reception will gladly help you: ${receptionPhone}.`
    : `I'm not certain about that — our reception will gladly help you.`;
  try {
    const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      output_config: { effort: "low" },
      system: systemPrompt(ctx.hotel.name, receptionPhone, context),
      messages: [{ role: "user", content: String(question).slice(0, 1000) }],
    });
    const answer = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return { status: 200, body: { ok: true, answer: answer || handoff } };
  } catch (e) {
    // Never leave the guest without a reply — hand off to reception on any model/API error.
    return { status: 200, body: { ok: true, answer: handoff } };
  }
}

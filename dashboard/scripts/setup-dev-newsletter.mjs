// ============================================================================
// AI OLLY Dashboard — DEV Newsletter seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Synthetic newsletter data for Sprint 7: subscribers (active-consent /
// revoked-consent / missing-consent / unsubscribed / suppressed / bounced,
// locale variety) with real granted/revoked consents, a static + a rule segment,
// a draft + a published template (with published_snapshot), a draft + scheduled
// (frozen) + a sent campaign with recipients/events, and one webhook event.
// Idempotent. Reserved/test domains only. No real recipients, no real Brevo IDs.
//
//   node dashboard/scripts/setup-dev-newsletter.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const iso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString(); };
const CONTENT = { version: 1, blocks: [{ type: "heading", level: 2, text: "Welcome to Demo Hotel" }, { type: "paragraph", text: "Thank you for subscribing. Here's what's new this season." }, { type: "link", label: "See our offers", url: "https://example.com/offers" }, { type: "divider" }] };

async function upsert(table, match, row) {
  let q = svc.from(table).select("id"); for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const f = await q.maybeSingle();
  if (f.data?.id) { const u = await svc.from(table).update(row).eq("id", f.data.id); if (u.error) throw new Error(`${table} upd: ${u.error.message}`); return f.data.id; }
  const r = await svc.from(table).insert({ ...match, ...row }).select("id").single(); if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.data.id;
}

async function main() {
  console.log("AI OLLY newsletter seed →", readEnv("SUPABASE_URL"), "\n");
  const { data: hotel } = await svc.from("hotels").select("id").eq("slug", "dash-demo-hotel").single();
  if (!hotel) throw new Error("run setup-dev-user.mjs first");
  const H = hotel.id;

  // ── marketing consent template (published) ──────────────────────────────────
  const TEXT = "[SYNTHETIC — dev only] I agree to receive marketing emails from Demo Hotel and understand I can unsubscribe at any time.";
  const ctmpl = await upsert("consent_templates", { hotel_id: H, key: "marketing-emails", locale: "en", version: 1 }, { title: "Marketing email consent", body_text: TEXT, status: "published", active: true, published_at: iso(-20) });

  // synthetic guests + consents (granted / revoked) for consent linkage
  const guest = async (ext, name) => upsert("guests", { hotel_id: H, external_source: "nl-seed", external_id: ext }, { first_name: name, last_name: "Test", preferred_locale: "en" });
  const consent = async (guestId, status) => upsert("consents", { hotel_id: H, guest_id: guestId, template_id: ctmpl }, { consent_type: "marketing-emails", consent_version: 1, locale: "en", consent_text_snapshot: TEXT, signed_name: "Guest Test", signed_at: iso(-10), status, revoked_at: status === "revoked" ? iso(-3) : null });
  const gAnna = await guest("g-anna", "Anna"), cAnna = await consent(gAnna, "granted");
  const gBruno = await guest("g-bruno", "Bruno"), cBruno = await consent(gBruno, "granted");
  const gDario = await guest("g-dario", "Dario"), cDario = await consent(gDario, "revoked");

  // ── subscribers ─────────────────────────────────────────────────────────────
  const sub = async (email, row) => upsert("newsletter_subscribers", { hotel_id: H, email }, row);
  const anna = await sub("anna@example.com", { first_name: "Anna", last_name: "Ang", locale: "en", country_code: "US", status: "subscribed", source: "signup_form", subscribed_at: iso(-15), consent_id: cAnna, guest_id: gAnna, tags: ["vip"] });
  const bruno = await sub("bruno@example.net", { first_name: "Bruno", last_name: "Bianchi", locale: "it", country_code: "IT", status: "subscribed", source: "front_desk", subscribed_at: iso(-12), consent_id: cBruno, guest_id: gBruno, tags: ["vip"] });
  await sub("clara@example.org", { first_name: "Clara", last_name: "Costa", locale: "en", status: "unsubscribed", source: "signup_form", subscribed_at: iso(-40), unsubscribed_at: iso(-5) });
  await sub("dario@example.com", { first_name: "Dario", last_name: "D", locale: "hr", status: "subscribed", source: "signup_form", subscribed_at: iso(-9), consent_id: cDario, guest_id: gDario });
  await sub("emil@example.de", { first_name: "Emil", last_name: "E", locale: "de", status: "subscribed", source: "import", subscribed_at: iso(-8) }); // NO consent
  await sub("frida@example.com", { first_name: "Frida", last_name: "F", locale: "en", status: "suppressed", source: "signup_form" });
  await sub("greta@example.com", { first_name: "Greta", last_name: "G", locale: "en", status: "bounced", source: "import" });

  // ── segments (static + rule) ────────────────────────────────────────────────
  const segVip = await upsert("newsletter_segments", { hotel_id: H, key: "vip-guests" }, { name: "VIP guests", type: "static", rules: null, active: true });
  const segEn = await upsert("newsletter_segments", { hotel_id: H, key: "english-audience" }, { name: "English audience", type: "rule", rules: { match: "all", conditions: [{ field: "locale", op: "eq", value: "en" }] }, active: true });
  for (const s of [anna, bruno]) { const f = await svc.from("newsletter_segment_members").select("segment_id").match({ segment_id: segVip, subscriber_id: s }).maybeSingle(); if (!f.data) await svc.from("newsletter_segment_members").insert({ segment_id: segVip, subscriber_id: s }); }

  // ── templates (draft + published w/ snapshot) ───────────────────────────────
  const snap = { subject: "Season news from Demo Hotel", preview_text: "What's new this season", content: CONTENT, name: "Welcome newsletter", locale: "en", header_asset_id: null, published_at: iso(-14) };
  const tplWelcome = await upsert("newsletter_templates", { hotel_id: H, key: "welcome", locale: "en" }, { name: "Welcome newsletter", subject: "Season news from Demo Hotel", preview_text: "What's new this season", content: CONTENT, status: "published", published_at: iso(-14), published_snapshot: snap });
  { const f = await svc.from("content_versions").select("id").eq("entity_type", "newsletter_template").eq("entity_id", tplWelcome).maybeSingle(); if (!f.data) await svc.from("content_versions").insert({ entity_type: "newsletter_template", entity_id: tplWelcome, version_number: 1, status: "published", snapshot: snap, change_summary: "Initial publish", hotel_id: H, published_at: iso(-14) }); }
  await upsert("newsletter_templates", { hotel_id: H, key: "spring-promo", locale: "en" }, { name: "Spring promo (draft)", subject: "Spring escapes", preview_text: "Draft — offers TBC", content: { version: 1, blocks: [{ type: "paragraph", text: "Draft content." }] }, status: "draft" });

  // ── campaigns (draft + scheduled(frozen) + sent) ────────────────────────────
  await upsert("newsletter_campaigns", { hotel_id: H, name: "Spring Draft" }, { template_id: tplWelcome, segment_id: segVip, status: "draft" });
  const segVipRow = (await svc.from("newsletter_segments").select("*").eq("id", segVip).single()).data;
  const campSched = await upsert("newsletter_campaigns", { hotel_id: H, name: "Spring Newsletter" }, { template_id: tplWelcome, segment_id: segVip, status: "scheduled", scheduled_at: iso(3), subject_snapshot: snap.subject, preview_text_snapshot: snap.preview_text, content_snapshot: snap.content, segment_snapshot: segVipRow, recipient_total: 2 });
  const campSent = await upsert("newsletter_campaigns", { hotel_id: H, name: "Winter Recap" }, { template_id: tplWelcome, segment_id: segVip, status: "sent", scheduled_at: iso(-6), sent_at: iso(-5), subject_snapshot: snap.subject, preview_text_snapshot: snap.preview_text, content_snapshot: snap.content, segment_snapshot: segVipRow, brevo_campaign_id: "dev-fake-001", recipient_total: 2, delivered_total: 2, opened_total: 1, clicked_total: 1, bounced_total: 0, unsubscribed_total: 0 });

  // recipients + events for the sent campaign
  const rec = async (subId, row) => upsert("newsletter_campaign_recipients", { campaign_id: campSent, subscriber_id: subId }, row);
  await rec(anna, { hotel_id: H, delivery_status: "clicked", brevo_message_id: "dev-msg-anna", sent_at: iso(-5), delivered_at: iso(-5), opened_at: iso(-5), clicked_at: iso(-5) });
  await rec(bruno, { hotel_id: H, delivery_status: "delivered", brevo_message_id: "dev-msg-bruno", sent_at: iso(-5), delivered_at: iso(-5) });
  { const c = await svc.from("newsletter_events").select("id", { count: "exact", head: true }).eq("campaign_id", campSent);
    if ((c.count ?? 0) === 0) await svc.from("newsletter_events").insert([
      { hotel_id: H, campaign_id: campSent, subscriber_id: anna, event_type: "sent", occurred_at: iso(-5) },
      { hotel_id: H, campaign_id: campSent, subscriber_id: bruno, event_type: "sent", occurred_at: iso(-5) },
      { hotel_id: H, campaign_id: campSent, subscriber_id: anna, event_type: "delivered", occurred_at: iso(-5) },
      { hotel_id: H, campaign_id: campSent, subscriber_id: bruno, event_type: "delivered", occurred_at: iso(-5) },
      { hotel_id: H, campaign_id: campSent, subscriber_id: anna, event_type: "opened", occurred_at: iso(-5) },
      { hotel_id: H, campaign_id: campSent, subscriber_id: anna, event_type: "clicked", occurred_at: iso(-5) },
    ]); }
  // one synthetic webhook event (idempotent)
  { const f = await svc.from("newsletter_webhook_events").select("id").eq("provider", "brevo").eq("provider_event_id", "nl-seed-evt-1").maybeSingle();
    if (!f.data) await svc.from("newsletter_webhook_events").insert({ hotel_id: H, provider: "brevo", provider_event_id: "nl-seed-evt-1", event_type: "delivered", payload: { event: "delivered" }, processed_at: iso(-5) }); }

  console.log("  ✓ 7 subscribers (active/revoked/missing consent, unsub/suppressed/bounced, locale variety)");
  console.log("  ✓ static + rule segments, draft + published template (w/ snapshot + v1), draft + scheduled + sent campaigns");
  console.log("  ✓ recipients + delivery events + 1 webhook event");
  console.log("\n  Done. Open Newsletter.\n");
}
main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });

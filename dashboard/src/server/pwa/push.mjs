// ============================================================================
// Guest PWA push sending (Session 6). Web Push (VAPID) to a room's subscribed
// guests when a request's status changes. Server-only. VAPID keys come from env
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). The public key is exposed via /api/pwa-push-key;
// the private key never leaves the server. Dead subscriptions (404/410) are deactivated.
// ============================================================================
import webpush from "web-push";
import { sb } from "./guest.mjs";

export function publicKey() { return process.env.VAPID_PUBLIC_KEY || ""; }

let vapidReady = false;
function configureVapid() {
  if (vapidReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:info@pressmax.net", pub, priv);
  vapidReady = true;
  return true;
}

// Guest-facing message per request status (plain, friendly; SW renders {title, body}).
function messageFor(status, type) {
  const t = (type || "request").replace(/_/g, " ");
  switch (status) {
    case "acknowledged": return { title: "✓ Request received", body: `Your ${t} request has been acknowledged. We'll be in touch shortly.` };
    case "in_progress": return { title: "⚙ In progress", body: `Your ${t} request is being taken care of by our team.` };
    case "resolved": return { title: "✅ All set", body: `Your ${t} request is complete. Please contact reception for any details.` };
    default: return null; // new / closed / cancelled → no guest push
  }
}

/** Send a status-change push to the room's active subscriptions. Returns {sent, failed, skipped}. */
export async function notifyRequest(requestId) {
  const client = sb();
  const req = (await client.from("guest_requests").select("hotel_id, room_id, status, request_type").eq("id", requestId).maybeSingle()).data;
  if (!req || !req.room_id) return { skipped: "no_request_or_room" };
  const msg = messageFor(req.status, req.request_type);
  if (!msg) return { skipped: `status ${req.status}` };
  if (!configureVapid()) return { skipped: "vapid_not_configured" };

  const subs = (await client.from("push_subscriptions").select("id, endpoint, p256dh, auth_key")
    .eq("hotel_id", req.hotel_id).eq("room_id", req.room_id).eq("active", true)).data || [];
  const payload = JSON.stringify({ ...msg, tag: "concierge-update", url: "/pwa/" });
  let sent = 0, failed = 0;
  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } };
    try { await webpush.sendNotification(subscription, payload); sent++; await client.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id); }
    catch (e) {
      failed++;
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await client.from("push_subscriptions").update({ active: false, revoked_at: new Date().toISOString() }).eq("id", s.id);
    }
  }
  return { sent, failed, total: subs.length };
}

/** Verify the caller's JWT and that they may act on `hotelId` (reception/hotel_admin/platform_admin). */
export async function requireStaff(req, hotelId) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) { const e = new Error("Not authenticated."); e.status = 401; throw e; }
  const c = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: u } = await c.auth.getUser();
  if (!u?.user) { const e = new Error("Not authenticated."); e.status = 401; throw e; }
  const { data: prof } = await c.from("profiles").select("is_platform_admin").eq("user_id", u.user.id).maybeSingle();
  if (prof?.is_platform_admin) return true;
  const { data: m } = await c.from("hotel_memberships").select("role, status").eq("hotel_id", hotelId).eq("user_id", u.user.id).maybeSingle();
  if (m && m.status === "active" && ["reception", "hotel_admin"].includes(m.role)) return true;
  const e = new Error("Not allowed."); e.status = 403; throw e;
}

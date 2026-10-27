// Guest PWA endpoint — return the VAPID PUBLIC key (safe to expose). Private key never leaves the server.
import { publicKey } from "@/server/pwa/push.mjs";
import { reply, options } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function GET() {
  const key = publicKey();
  return key ? reply({ status: 200, body: { ok: true, publicKey: key } })
             : reply({ status: 503, body: { ok: false, error: "Push not configured" } });
}

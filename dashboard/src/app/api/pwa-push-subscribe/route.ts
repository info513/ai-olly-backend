// Guest PWA endpoint — store the guest's Web Push subscription for this room.
import { subscribePush } from "@/server/pwa/guest.mjs";
import { reply, options, readBody } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) {
  const body = await readBody(req);
  body.userAgent = req.headers.get("user-agent") || "";
  return reply(await subscribePush(body));
}

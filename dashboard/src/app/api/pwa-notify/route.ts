// Staff → guest push. Called by the dashboard after a request status change. JWT-authed
// (reception / hotel_admin / platform_admin of the request's hotel). Sends to the room's subs.
import { NextResponse } from "next/server";
import { sb } from "@/server/pwa/guest.mjs";
import { notifyRequest, requireStaff } from "@/server/pwa/push.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestId = String(body.requestId ?? "");
    if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });
    const r = (await sb().from("guest_requests").select("hotel_id").eq("id", requestId).maybeSingle()).data;
    if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
    await requireStaff(req, r.hotel_id);
    return NextResponse.json(await notifyRequest(requestId));
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? "error" }, { status: e?.status ?? 500 }); }
}

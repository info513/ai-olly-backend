// POST /api/pms/mappings — map (or clear) one provider unit → room.
// platform_admin OR hotel_admin only. A room from another hotel is rejected.
import { NextResponse } from "next/server";
import { assertDevRef, requirePmsAdmin } from "@/server/pms/authz";
import { upsertMapping } from "@/server/pms/service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertDevRef();
    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotelId ?? "");
    await requirePmsAdmin(req, hotelId);
    const externalId = String(body.externalId ?? "");
    const roomId = body.roomId ? String(body.roomId) : null;
    if (!externalId) return NextResponse.json({ error: "externalId required" }, { status: 400 });
    return NextResponse.json(await upsertMapping(hotelId, externalId, roomId));
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? "error" }, { status: e?.status ?? 500 }); }
}

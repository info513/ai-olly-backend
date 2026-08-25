// POST /api/pms/sync-preview — dry-run the synthetic Rentlio sync (no writes).
// Returns would-create / would-update / needs-mapping / skip counts. Admin only.
import { NextResponse } from "next/server";
import { assertDevRef, requirePmsAdmin } from "@/server/pms/authz";
import { runSyncPreview } from "@/server/pms/service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertDevRef();
    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotelId ?? "");
    await requirePmsAdmin(req, hotelId);
    return NextResponse.json(await runSyncPreview(hotelId));
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? "error" }, { status: e?.status ?? 500 }); }
}

// GET  /api/pms/integration?hotelId=…  → safe, credential-free integration view.
// POST /api/pms/integration            → DEV synthetic connect (seed + provider units).
// platform_admin OR hotel_admin only. DEV-only. No credential/token/PII ever returned.
import { NextResponse } from "next/server";
import { assertDevRef, requirePmsAdmin } from "@/server/pms/authz";
import { getIntegrationView, connectSynthetic } from "@/server/pms/service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    assertDevRef();
    const hotelId = new URL(req.url).searchParams.get("hotelId") ?? "";
    await requirePmsAdmin(req, hotelId);
    return NextResponse.json(await getIntegrationView(hotelId));
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? "error" }, { status: e?.status ?? 500 }); }
}

export async function POST(req: Request) {
  try {
    assertDevRef();
    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotelId ?? "");
    const caller = await requirePmsAdmin(req, hotelId);
    await connectSynthetic(hotelId, caller.userId);
    return NextResponse.json(await getIntegrationView(hotelId));
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? "error" }, { status: e?.status ?? 500 }); }
}

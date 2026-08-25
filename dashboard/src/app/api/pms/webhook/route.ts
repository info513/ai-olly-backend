// POST /api/pms/webhook — PMS (Rentlio) webhook ingestion endpoint.
// Authenticated by the per-hotel SHARED TOKEN in the payload (constant-time compared
// against the stored sha256 hash — never a JWT, never a raw token at rest). Idempotent
// on event.id, re-fetches the reservation as the source of truth, and never mutates
// consent or room QR tokens. DEV-only in R2 (synthetic adapter); R3 swaps the transport.
// Always returns 200 for recognized-but-internally-failed events so the provider does
// not retry-storm; reconciliation repairs those. 401 only for an unrecognized token.
import { NextResponse } from "next/server";
import { assertDevRef } from "@/server/pms/authz";
import { ingestWebhook } from "@/server/pms/service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try { assertDevRef(); }
  catch (e: any) { return NextResponse.json({ error: e?.message ?? "DEV-only." }, { status: e?.status ?? 403 }); }
  let payload: any;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  try {
    const { status, body } = await ingestWebhook(payload);
    return NextResponse.json(body, { status });
  } catch (e: any) { return NextResponse.json({ error: "error" }, { status: e?.status ?? 500 }); }
}

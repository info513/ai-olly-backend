// Shared helpers for the guest PWA API routes. CORS is permissive because these
// endpoints are guest-facing (the PWA may be served from a different origin) and
// are themselves gated by the per-room access token — no cookies/credentials.
import { NextResponse } from "next/server";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export function reply(r: { status: number; body: unknown }) {
  return NextResponse.json(r.body, { status: r.status, headers: CORS });
}
export function options() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Read { slug, room, token } from POST body or query string, matching the old Express contract. */
export async function readParams(req: Request): Promise<{ slug: string; room: string; token: string }> {
  const { slug, room, token } = await readBody(req);
  return { slug, room, token };
}

/** Full merged params (body + query) — for endpoints with extra fields (question, category, …). */
export async function readBody(req: Request): Promise<any> {
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* empty body ok */ } }
  const out: Record<string, any> = { ...body };
  url.searchParams.forEach((v, k) => { if (out[k] == null) out[k] = v; });
  out.slug = String(out.slug || "antique-split");
  out.room = String(out.room || "");
  out.token = String(out.token || "");
  return out;
}

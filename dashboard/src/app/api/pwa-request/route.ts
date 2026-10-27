// Guest PWA endpoint — create a guest request (lands in the dashboard). Same contract as Express /api/pwa-request.
import { createRequest } from "@/server/pwa/guest.mjs";
import { reply, options, readBody } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) { return reply(await createRequest(await readBody(req))); }

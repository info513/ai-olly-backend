// Guest PWA endpoint — same contract as the old Express /api/pwa-routes. Reads Supabase.
import { routes } from "@/server/pwa/guest.mjs";
import { reply, options, readParams } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) { return reply(await routes(await readParams(req))); }

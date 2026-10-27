// Guest PWA endpoint — same contract as the old Express /api/pwa-events. Reads Supabase.
import { events } from "@/server/pwa/guest.mjs";
import { reply, options, readParams } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) { return reply(await events(await readParams(req))); }

// Guest PWA endpoint — same contract as the old Express /api/pwa-split-today-events. Reads Supabase.
import { splitToday } from "@/server/pwa/guest.mjs";
import { reply, options, readParams } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function GET(req: Request) { return reply(await splitToday(await readParams(req))); }

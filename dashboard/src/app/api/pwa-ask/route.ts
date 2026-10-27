// Guest PWA endpoint — "Ask Dioclea" (Claude). Same contract as the old Express /api/pwa-ask.
import { ask } from "@/server/pwa/ask.mjs";
import { reply, options, readBody } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) { return reply(await ask(await readBody(req))); }

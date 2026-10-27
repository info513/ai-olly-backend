// Guest PWA endpoint — post-checkout feedback. Same contract as the old Express /api/pwa-feedback.
import { submitFeedback } from "@/server/pwa/guest.mjs";
import { reply, options, readBody } from "@/server/pwa/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return options(); }
export async function POST(req: Request) { return reply(await submitFeedback(await readBody(req))); }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Private asset signed-URL broker — server-side ONLY (Sprint 6).
// ----------------------------------------------------------------------------
// The private buckets (consent-files, private-documents) have NO authenticated
// Storage policies, so the browser cannot read them. This route:
//   • authenticates the caller (anon key + their JWT),
//   • checks authorization via RLS — it reads the asset row with the CALLER'S
//     client, so private types are only visible to platform_admin/hotel_admin/
//     reception of the owning hotel (assets_select policy). No row => 403.
//   • mints a short-lived signed URL with the service-role key (server env only,
//     never shipped to the browser).
// No signing secret and no service key ever reach the client.
// ============================================================================

export const runtime = "nodejs";
const EXPIRES = 60; // seconds

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { assetId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!body.assetId) return NextResponse.json({ error: "Missing asset." }, { status: 400 });

  // caller-scoped client — RLS decides whether they may see this asset
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user } = await caller.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: asset, error } = await caller.from("assets").select("bucket_name,storage_path").eq("id", body.assetId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load asset." }, { status: 500 });
  if (!asset) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!asset.bucket_name || !asset.storage_path) return NextResponse.json({ error: "No file for this asset." }, { status: 400 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: signed, error: sErr } = await svc.storage.from(asset.bucket_name).createSignedUrl(asset.storage_path, EXPIRES);
  if (sErr || !signed) return NextResponse.json({ error: "Could not create a preview link." }, { status: 500 });

  return NextResponse.json({ url: signed.signedUrl, expiresIn: EXPIRES });
}

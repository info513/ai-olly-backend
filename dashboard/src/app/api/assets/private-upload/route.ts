import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assetMaxBytes, bucketForType, BUCKET_MIME, safeFilename, type AssetType } from "@/data/asset-constants";

// ============================================================================
// Private asset upload broker — server-side ONLY (Sprint 6).
// ----------------------------------------------------------------------------
// Uploads signatures / consent documents to the private buckets, which the
// browser cannot write to. Authorization is enforced by RLS: the asset row is
// INSERTED with the CALLER'S client, so only platform_admin/hotel_admin/reception
// of the owning hotel may create private-type assets (assets_ins policy). The
// service-role key (server env only) does just two things: move the file bytes
// into the private bucket and flip the row to ready. The path is derived
// server-side — the browser never dictates an arbitrary Storage path.
// ============================================================================

export const runtime = "nodejs";
const PRIVATE_TYPES: AssetType[] = ["consent_signature", "consent_pdf", "document"];
const FOLDER: Record<string, string> = { consent_signature: "consent-signatures", consent_pdf: "consent-pdfs", document: "documents" };

/** Reject a declared MIME that doesn't match the file's magic bytes. */
function sniffOk(mime: string, bytes: Uint8Array): boolean {
  const hex = (n: number) => Array.from(bytes.slice(0, n)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const head = hex(8);
  if (mime === "image/png") return head.startsWith("89504e47");
  if (mime === "image/jpeg") return head.startsWith("ffd8ff");
  if (mime === "application/pdf") return head.startsWith("25504446"); // %PDF
  if (mime === "image/svg+xml") { const s = new TextDecoder().decode(bytes.slice(0, 256)).trimStart(); return s.startsWith("<?xml") || s.startsWith("<svg"); }
  return false;
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const file = form.get("file");
  const assetType = String(form.get("assetType") ?? "") as AssetType;
  const hotelId = String(form.get("hotelId") ?? "");
  const displayName = String(form.get("displayName") ?? "");

  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (!hotelId) return NextResponse.json({ error: "Missing hotel." }, { status: 400 });
  if (!PRIVATE_TYPES.includes(assetType)) return NextResponse.json({ error: "This route handles private assets only." }, { status: 400 });

  const bucket = bucketForType(assetType);
  const mime = file.type || "application/octet-stream";
  if (!BUCKET_MIME[bucket].includes(mime)) return NextResponse.json({ error: `File type ${mime} is not allowed here.` }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "Empty file." }, { status: 400 });
  if (file.size > assetMaxBytes(assetType)) return NextResponse.json({ error: "File is too large for this type." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffOk(mime, bytes)) return NextResponse.json({ error: "File contents don’t match the declared type." }, { status: 400 });

  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user } = await caller.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const id = crypto.randomUUID();
  const path = `hotels/${hotelId}/${FOLDER[assetType]}/${id}/${safeFilename(file.name)}`;

  // RLS gate: only platform_admin/hotel_admin/reception may create private assets.
  const { error: insErr } = await caller.from("assets").insert({
    id, hotel_id: hotelId, asset_type: assetType, bucket_name: bucket, storage_path: path,
    original_filename: file.name, display_name: displayName || file.name, mime_type: mime, file_size_bytes: file.size,
    status: "pending", uploaded_by: user.user.id,
  });
  if (insErr) {
    const denied = /row-level security|violates row-level|permission/i.test(insErr.message);
    return NextResponse.json({ error: denied ? "You’re not allowed to upload consent files." : "Could not create the asset." }, { status: denied ? 403 : 400 });
  }

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { error: upErr } = await svc.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) {
    await svc.from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", id);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
  await svc.from("assets").update({ status: "ready" }).eq("id", id);

  return NextResponse.json({ assetId: id });
}

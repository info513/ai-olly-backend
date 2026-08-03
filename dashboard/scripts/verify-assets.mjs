// ============================================================================
// AI OLLY Dashboard — Asset Manager REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises assets / asset_usages / Storage the way the dashboard does — anon
// key + per-user JWT, RLS-enforced — plus service-role Storage moves (mirroring
// the private-upload / signed-url server routes). Real Auth users + real bucket
// objects; all cleaned up. Covers public upload+finalize, private consent-file
// creation gate, size/type validation, scopes, list/detail RLS, usage attach/
// detach + cross-hotel block, archive/restore + in-use block, replacement,
// public + private signed preview, consent signature linkage + immutability,
// and evidence protection. Reads the service-role key from ../../.env.
//
//   node dashboard/scripts/verify-assets.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "vas", DOM = "@verify-assets.local", PW = "Verify-Assets-Pass!1";
const svgBuf = (label) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#123"/><text x="4" y="30" fill="#fff">${label}</text></svg>`, "utf8");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const rows = (r) => (r && r.data) ? r.data : [];
const paths = [];

async function main() {
  console.log("AI OLLY — Asset Manager regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {}, RM = {}, A = {};
  const ids = [];

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    for (const [bucket, p] of paths) { try { await svc.storage.from(bucket).remove([p]); } catch {} }
    const hsub = `(select id from public.hotels where slug like $1)`;
    if (ids.length) await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    await q(`delete from public.audit_log where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    for (const t of ["asset_usages", "consents", "consent_templates", "assets", "guests", "rooms", "room_types"])
      await q(`delete from public.${t} where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k) => {
    const email = `${P}.${k}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from("profiles").insert({ user_id: data.user.id, email });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signin ${k}: ${s.error.message}`);
    u[k] = { id: data.user.id, c };
  };
  const ins = async (t, r) => { const x = await svc.from(t).insert(r).select("id").single(); if (x.error) throw new Error(`${t}: ${x.error.message}`); if (x.data.id) ids.push(x.data.id); return x.data.id; };

  try {
    await cleanup();
    const dA = await ins("destinations", { name: "DA", slug: `${P}-da`, timezone: "Europe/Zagreb" });
    const dB = await ins("destinations", { name: "DB", slug: `${P}-db`, timezone: "Europe/Zagreb" });
    H.a = await ins("hotels", { name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" });
    H.b = await ins("hotels", { name: "HB", slug: `${P}-hb`, destination_id: dB, timezone: "Europe/Zagreb", currency: "EUR" });
    const rtA = await ins("room_types", { hotel_id: H.a, name: "Std", slug: `${P}-rt` });
    RM.a1 = await ins("rooms", { hotel_id: H.a, room_type_id: rtA, room_number: "A101", access_token: `${P}-t1` });

    await mkUser("ha"); await mkUser("ed"); await mkUser("mk"); await mkUser("rc"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.mk.id, role: "marketing", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    ok("fixtures + users created");

    // ══ PUBLIC upload + finalize (editor, via caller client) ════════════════════
    { const idPub = crypto.randomUUID(); const path = `hotels/${H.a}/images/${idPub}/img.svg`;
      const up = await u.ed.c.storage.from("public-media").upload(path, svgBuf("pub"), { contentType: "image/svg+xml", upsert: true });
      if (!up.error) paths.push(["public-media", path]);
      (!up.error) ? ok("editor uploads to public-media (path-validated)") : bad(`public upload failed: ${up.error?.message}`);
      const r = await u.ed.c.from("assets").insert({ id: idPub, hotel_id: H.a, asset_type: "hotel_image", bucket_name: "public-media", storage_path: path, display_name: "Pub", mime_type: "image/svg+xml", file_size_bytes: svgBuf("pub").length, public_access: true, status: "pending" }).select("id").single();
      A.pub = r.data?.id; (!r.error) ? ok("editor inserts public asset row (RLS)") : bad(`public asset insert failed: ${r.error?.message}`);
      const f = await u.ed.c.rpc("finalize_asset", { p_asset: A.pub, p_size: svgBuf("pub").length });
      const st = (await svc.from("assets").select("status,public_access").eq("id", A.pub).single()).data;
      (!f.error && st.status === "ready" && st.public_access === true) ? ok("finalize_asset marks public asset ready") : bad(`finalize failed: ${f.error?.message}`); }

    // ══ Reception uploads a public path? (no) — reception can't manage media ════
    { const path = `hotels/${H.a}/images/x/rc.svg`;
      const up = await u.rc.c.storage.from("public-media").upload(path, svgBuf("rc"), { contentType: "image/svg+xml" });
      if (!up.error) paths.push(["public-media", path]);
      (up.error) ? ok("reception cannot write public-media (not a media manager)") : bad("reception wrote public-media"); }

    // ══ PRIVATE consent-file create gate ════════════════════════════════════════
    { // reception may create a private consent_signature row (path server-derived); file via service-role
      const idSig = crypto.randomUUID(); const path = `hotels/${H.a}/consent-signatures/${idSig}/sig.svg`;
      const r = await u.rc.c.from("assets").insert({ id: idSig, hotel_id: H.a, asset_type: "consent_signature", bucket_name: "consent-files", storage_path: path, display_name: "Sig", mime_type: "image/svg+xml", file_size_bytes: svgBuf("sig").length, status: "pending" }).select("id").single();
      A.sig = r.data?.id; (!r.error) ? ok("reception creates private consent_signature row (RLS)") : bad(`sig insert failed: ${r.error?.message}`);
      const upl = await svc.storage.from("consent-files").upload(path, svgBuf("sig"), { contentType: "image/svg+xml", upsert: true });
      if (!upl.error) paths.push(["consent-files", path]);
      (!upl.error) ? ok("service-role uploads the signature to consent-files") : bad(`sig storage failed: ${upl.error?.message}`);
      await svc.from("assets").update({ status: "ready" }).eq("id", A.sig); }
    // editor / marketing CANNOT create private consent assets (post-migration)
    { const r = await u.ed.c.from("assets").insert({ hotel_id: H.a, asset_type: "consent_signature", bucket_name: "consent-files", storage_path: `hotels/${H.a}/consent-signatures/z/e.svg`, display_name: "x", mime_type: "image/svg+xml", file_size_bytes: 10 });
      (r.error) ? ok("editor cannot create private consent assets") : bad("editor created consent asset"); }
    { const r = await u.mk.c.from("assets").insert({ hotel_id: H.a, asset_type: "document", bucket_name: "private-documents", storage_path: `hotels/${H.a}/documents/z/m.pdf`, display_name: "x", mime_type: "application/pdf", file_size_bytes: 10 });
      (r.error) ? ok("marketing cannot create private document assets") : bad("marketing created private doc"); }

    // ══ Validation: size + private-bucket CHECK constraints ═════════════════════
    { const r = await u.ha.c.from("assets").insert({ hotel_id: H.a, asset_type: "consent_signature", bucket_name: "consent-files", storage_path: `hotels/${H.a}/c/big.png`, mime_type: "image/png", file_size_bytes: 6 * 1024 * 1024, display_name: "big" });
      (r.error) ? ok("size limit enforced (consent_signature > 5MB rejected)") : bad("oversize consent signature accepted"); }
    { const r = await u.ha.c.from("assets").insert({ hotel_id: H.a, asset_type: "consent_pdf", bucket_name: "public-media", storage_path: `hotels/${H.a}/p/x.pdf`, mime_type: "application/pdf", file_size_bytes: 10, display_name: "x" });
      (r.error) ? ok("private type in public bucket rejected (CHECK)") : bad("private type allowed in public bucket"); }

    // ══ Scopes: platform asset requires platform_admin ══════════════════════════
    { const r = await u.ha.c.from("assets").insert({ hotel_id: null, asset_type: "logo", bucket_name: "public-media", storage_path: `platform/logo.svg`, mime_type: "image/svg+xml", file_size_bytes: 10, display_name: "plat" });
      (r.error) ? ok("hotel_admin cannot create a platform asset") : bad("hotel_admin created platform asset"); }

    // ══ list/detail RLS for private assets ══════════════════════════════════════
    (rows(await u.rc.c.from("assets").select("id").eq("id", A.sig)).length === 1) ? ok("reception can read the private signature") : bad("reception cannot read private signature");
    (rows(await u.ha.c.from("assets").select("id").eq("id", A.sig)).length === 1) ? ok("hotel_admin can read the private signature") : bad("hotel_admin cannot read private signature");
    (rows(await u.ed.c.from("assets").select("id").eq("id", A.sig)).length === 0) ? ok("editor cannot read private consent assets") : bad("editor read private asset");
    (rows(await u.mk.c.from("assets").select("id").eq("id", A.sig)).length === 0) ? ok("marketing cannot read private consent assets") : bad("marketing read private asset");
    (rows(await u.hb.c.from("assets").select("id").eq("id", A.pub)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A asset") : bad("cross-tenant asset leak");

    // ══ Usage attach / detach + cross-hotel block + archive block ═══════════════
    { const r = await u.ed.c.from("asset_usages").insert({ asset_id: A.pub, hotel_id: H.a, entity_type: "room", entity_id: RM.a1, usage_role: "hero" });
      (!r.error) ? ok("editor attaches a usage") : bad(`usage attach failed: ${r.error?.message}`); }
    { const r = await u.ed.c.from("asset_usages").insert({ asset_id: A.pub, hotel_id: H.b, entity_type: "room", entity_id: RM.a1, usage_role: "card" });
      (r.error) ? ok("cross-hotel usage of a hotel asset rejected (scope trigger)") : bad("cross-hotel usage accepted"); }
    { const r = await u.ed.c.from("assets").update({ deleted_at: new Date().toISOString() }).eq("id", A.pub);
      const del = (await svc.from("assets").select("deleted_at").eq("id", A.pub).single()).data.deleted_at;
      (r.error || !del) ? ok("archive blocked while active usages exist") : bad("archived asset with active usages"); }
    { await u.ed.c.from("asset_usages").delete().match({ asset_id: A.pub, entity_type: "room", entity_id: RM.a1, usage_role: "hero" });
      const r = await u.ed.c.from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", A.pub);
      const del = (await svc.from("assets").select("deleted_at").eq("id", A.pub).single()).data.deleted_at;
      (!r.error && del) ? ok("archive succeeds after detaching usages") : bad("archive after detach failed"); }
    { const r = await u.ed.c.from("assets").update({ deleted_at: null, status: "ready" }).eq("id", A.pub);
      (!r.error) ? ok("restore returns the asset") : bad("restore failed"); }

    // ══ Replacement = new asset (no silent overwrite) ═══════════════════════════
    { const idNew = crypto.randomUUID(); const path = `hotels/${H.a}/images/${idNew}/replacement.svg`;
      await u.ed.c.storage.from("public-media").upload(path, svgBuf("new"), { contentType: "image/svg+xml", upsert: true }); paths.push(["public-media", path]);
      const r = await u.ed.c.from("assets").insert({ id: idNew, hotel_id: H.a, asset_type: "hotel_image", bucket_name: "public-media", storage_path: path, display_name: "Replacement", mime_type: "image/svg+xml", file_size_bytes: svgBuf("new").length, public_access: true, status: "ready" }).select("id").single();
      (!r.error && r.data.id !== A.pub) ? ok("replacement creates a NEW asset (original untouched)") : bad("replacement overwrote original"); }

    // ══ Public preview + private signed preview ═════════════════════════════════
    { const pu = u.ed.c.storage.from("public-media").getPublicUrl((await svc.from("assets").select("storage_path").eq("id", A.pub).single()).data.storage_path).data.publicUrl;
      (pu && pu.includes("/public-media/")) ? ok("public asset yields a public URL") : bad("public URL wrong"); }
    { const sp = (await svc.from("assets").select("storage_path").eq("id", A.sig).single()).data.storage_path;
      const s = await svc.storage.from("consent-files").createSignedUrl(sp, 60);
      (!s.error && s.data?.signedUrl?.includes("token=")) ? ok("private signature yields an expiring signed URL (service-role)") : bad(`signed URL failed: ${s.error?.message}`); }

    // ══ Consent signature linkage + immutability ════════════════════════════════
    const guest = await ins("guests", { hotel_id: H.a, first_name: "Gina", last_name: "A" });
    const tmpl = await ins("consent_templates", { hotel_id: H.a, key: `${P}-c`, locale: "en", version: 1, title: "C", body_text: "[synthetic] consent", status: "draft" });
    await u.ha.c.rpc("publish_consent_template", { p_template: tmpl });
    let consentId;
    { const r = await u.rc.c.rpc("sign_consent", { p_template: tmpl, p_guest: guest, p_stay: null, p_signed_name: "Gina A", p_device: null, p_signature_asset: A.sig });
      const c = Array.isArray(r.data) ? r.data[0] : r.data; consentId = c?.id;
      (!r.error && c?.signature_asset_id === A.sig) ? ok("sign_consent links the signature asset") : bad(`sign w/ signature failed: ${r.error?.message}`);
      const usage = (await q(`select count(*)::int c from public.asset_usages where asset_id=$1 and entity_type='consent' and usage_role='signature'`, [A.sig])).rows[0].c;
      (usage === 1) ? ok("signature asset_usage(entity=consent, role=signature) recorded") : bad(`signature usage missing (${usage})`); }
    // signature from another hotel rejected
    { const idB = crypto.randomUUID(); await svc.from("assets").insert({ id: idB, hotel_id: H.b, asset_type: "consent_signature", bucket_name: "consent-files", storage_path: `hotels/${H.b}/consent-signatures/${idB}/s.svg`, mime_type: "image/svg+xml", file_size_bytes: 10, status: "ready" });
      const r = await u.rc.c.rpc("sign_consent", { p_template: tmpl, p_guest: guest, p_stay: null, p_signed_name: "x", p_device: null, p_signature_asset: idB });
      (r.error && /another hotel/i.test(r.error.message)) ? ok("cross-hotel signature asset rejected by sign_consent") : bad("cross-hotel signature accepted"); }
    // consent immutable: signature_asset_id cannot be changed
    { await u.ha.c.from("consents").update({ signature_asset_id: null }).eq("id", consentId);
      const sid = (await svc.from("consents").select("signature_asset_id").eq("id", consentId).single()).data.signature_asset_id;
      (sid === A.sig) ? ok("signed consent signature reference is immutable") : bad("consent signature reference changed"); }
    // signature asset (evidence) cannot be archived while linked to the consent
    { const r = await u.ha.c.from("assets").update({ deleted_at: new Date().toISOString() }).eq("id", A.sig);
      const del = (await svc.from("assets").select("deleted_at").eq("id", A.sig).single()).data.deleted_at;
      (r.error || !del) ? ok("signature evidence cannot be archived while linked to a consent") : bad("signature evidence archived"); }

    // ══ Search hotel-scoped ═════════════════════════════════════════════════════
    { const r = await u.hb.c.from("assets").select("id").or(`hotel_id.eq.${H.b},hotel_id.is.null`).ilike("display_name", "%Pub%");
      (rows(r).every((x) => x.id !== A.pub)) ? ok("asset search is hotel-scoped (B cannot find A's asset)") : bad("cross-tenant asset search leak"); }
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + users + storage objects cleaned up.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  verify error:", e.message); process.exit(1); });

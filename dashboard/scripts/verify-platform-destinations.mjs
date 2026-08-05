// ============================================================================
// AI OLLY Dashboard — Platform CMS Destinations REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the Destinations module the way the dashboard does — anon key + per-
// user JWT, RLS-enforced — plus the platform_admin-only publish/rollback/history
// RPCs. Real Auth users; cleaned up by domain + slug prefix. Covers:
//   create · edit draft · live-unchanged-before-publish · publish · version
//   creation · history · rollback (into a new draft) · archive/restore · slug
//   uniqueness · list/filter/search · switcher refresh · platform_admin access ·
//   hotel-role denial · anon denial · RLS cross-visibility · no hard delete ·
//   and no regression to the existing Split destination / Antique linkage.
// Reads keys from ../../.env.
//
//   node dashboard/scripts/verify-platform-destinations.mjs
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
const P = "vpd", DOM = "@verify-platform-destinations.local", PW = "Verify-Pd-Pass!1";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Platform Destinations regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {};

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='destination' and entity_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, platformAdmin = false) => {
    const email = `${P}.${k}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: platformAdmin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signin ${k}: ${s.error.message}`);
    u[k] = { id: data.user.id, c, email };
  };

  try {
    await cleanup();
    await mkUser("admin", true);     // platform_admin
    await mkUser("hotel", false);    // hotel-role member (no platform admin)
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    // A hotel linked to a destination, so the hotel user has destination access.
    const dCtx = await svc.from("destinations").insert({ name: "Ctx", slug: `${P}-ctx`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single();
    const hotel = await svc.from("hotels").insert({ name: "H", slug: `${P}-h`, destination_id: dCtx.data.id, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single();
    await svc.from("hotel_memberships").insert({ hotel_id: hotel.data.id, user_id: u.hotel.id, role: "hotel_admin", status: "active" });

    // ── 1. CREATE (platform_admin, via anon+JWT — RLS INSERT check) ────────────
    const created = await u.admin.c.from("destinations").insert({ name: "Split Test", slug: `${P}-alpha`, timezone: "Europe/Zagreb", default_locale: "en", destination_type: "city", country_code: "HR" }).select("id,status").single();
    (!created.error && created.data?.status === "draft") ? ok("platform_admin creates a draft destination") : bad(`create failed: ${created.error?.message}`);
    const id = created.data.id;

    // ── 2. EDIT DRAFT ──────────────────────────────────────────────────────────
    const edit1 = await u.admin.c.from("destinations").update({ short_description: "Adriatic city" }).eq("id", id);
    (!edit1.error) ? ok("platform_admin edits the draft") : bad(`edit failed: ${edit1.error?.message}`);

    // ── 3. PUBLISH (rpc) + VERSION creation ────────────────────────────────────
    const pub1 = await u.admin.c.rpc("publish_destination", { p_destination: id, p_change_summary: "v1" });
    (!pub1.error) ? ok("publish_destination succeeds for platform_admin") : bad(`publish failed: ${pub1.error?.message}`);
    const afterPub = (await svc.from("destinations").select("status,published_at,published_snapshot").eq("id", id).single()).data;
    (afterPub.status === "published" && afterPub.published_at && afterPub.published_snapshot) ? ok("publish sets status/published_at + writes live snapshot") : bad("publish did not set live state");
    const v1 = (await svc.from("content_versions").select("version_number,status").eq("entity_type", "destination").eq("entity_id", id)).data;
    (v1.length === 1 && v1[0].version_number === 1 && v1[0].status === "published") ? ok("content_version v1 created on publish") : bad(`version not created (${v1.length})`);

    // ── 4. LIVE UNCHANGED before republish ─────────────────────────────────────
    await u.admin.c.from("destinations").update({ name: "Split Edited" }).eq("id", id);
    const midEdit = (await svc.from("destinations").select("name,published_snapshot").eq("id", id).single()).data;
    (midEdit.name === "Split Edited" && midEdit.published_snapshot.name === "Split Test") ? ok("draft edit leaves the LIVE snapshot unchanged until publish") : bad("live snapshot changed by a draft edit!");

    // ── 5. REPUBLISH updates the live snapshot + bumps version ──────────────────
    const pub2 = await u.admin.c.rpc("publish_destination", { p_destination: id, p_change_summary: "v2" });
    const afterPub2 = (await svc.from("destinations").select("published_snapshot").eq("id", id).single()).data;
    const vCount = (await svc.from("content_versions").select("id", { count: "exact", head: true }).eq("entity_type", "destination").eq("entity_id", id)).count;
    (!pub2.error && afterPub2.published_snapshot.name === "Split Edited" && vCount === 2) ? ok("republish refreshes live snapshot + creates v2") : bad("republish snapshot/version wrong");

    // ── 6. HISTORY (list_destination_versions — admin) ─────────────────────────
    const hist = await u.admin.c.rpc("list_destination_versions", { p_destination: id });
    (!hist.error && (hist.data || []).length === 2) ? ok("list_destination_versions returns full history for admin") : bad(`history failed: ${hist.error?.message} (${hist.data?.length})`);

    // ── 7. ROLLBACK → new draft, live untouched ────────────────────────────────
    const v1id = (await svc.from("content_versions").select("id").eq("entity_type", "destination").eq("entity_id", id).eq("version_number", 1).single()).data.id;
    const rb = await u.admin.c.rpc("rollback_destination", { p_destination: id, p_version: v1id });
    const afterRb = (await svc.from("destinations").select("status,name,published_snapshot").eq("id", id).single()).data;
    (!rb.error && afterRb.status === "draft" && afterRb.name === "Split Test" && afterRb.published_snapshot.name === "Split Edited")
      ? ok("rollback restores v1 into a NEW draft; live snapshot stays at v2") : bad(`rollback wrong: ${rb.error?.message} status=${afterRb.status} name=${afterRb.name}`);

    // ── 8. ARCHIVE / RESTORE ───────────────────────────────────────────────────
    const arch = await u.admin.c.from("destinations").update({ status: "archived" }).eq("id", id);
    const isArch = (await svc.from("destinations").select("status").eq("id", id).single()).data.status;
    (!arch.error && isArch === "archived") ? ok("archive sets status=archived") : bad("archive failed");
    const rest = await u.admin.c.from("destinations").update({ status: "draft" }).eq("id", id);
    const isRest = (await svc.from("destinations").select("status").eq("id", id).single()).data.status;
    (!rest.error && isRest === "draft") ? ok("restore returns archived→draft") : bad("restore failed");

    // ── 9. SLUG UNIQUENESS ─────────────────────────────────────────────────────
    const dup = await u.admin.c.from("destinations").insert({ name: "Dup", slug: `${P}-alpha`, timezone: "Europe/Zagreb", default_locale: "en" });
    (dup.error && /duplicate|unique|23505/i.test(dup.error.message + (dup.error.code || ""))) ? ok("slug uniqueness enforced (duplicate rejected)") : bad("duplicate slug was NOT rejected");

    // ── 10. LIST / FILTER / SEARCH ─────────────────────────────────────────────
    const listAll = await u.admin.c.from("destinations").select("id,slug,status").neq("status", "archived").order("name");
    (!listAll.error && listAll.data.length >= 2) ? ok("admin list (non-archived) returns destinations") : bad("list failed");
    const filtered = await u.admin.c.from("destinations").select("id").eq("status", "published").limit(50);
    (!filtered.error && filtered.data.length >= 1) ? ok("status filter works") : bad("status filter failed");
    const searchRow = await u.admin.c.from("destinations").select("id,slug").ilike("slug", `${P}-ctx`);
    (!searchRow.error && searchRow.data.length === 1) ? ok("search (slug ilike) works") : bad("search failed");

    // ── 11. SWITCHER REFRESH: new published dest visible; archived excluded ─────
    const dNew = await svc.from("destinations").insert({ name: "Zed", slug: `${P}-zed`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single();
    await svc.from("destinations").update({ status: "published", published_snapshot: { name: "Zed" } }).eq("id", dNew.data.id);
    const switcher = await u.admin.c.from("destinations").select("slug,status").neq("status", "archived");
    const slugs = switcher.data.map((r) => r.slug);
    slugs.includes(`${P}-zed`) ? ok("switcher list surfaces a newly published destination") : bad("new destination missing from switcher list");
    await svc.from("destinations").update({ status: "archived" }).eq("id", dNew.data.id);
    const switcher2 = await u.admin.c.from("destinations").select("slug").neq("status", "archived");
    (!switcher2.data.map((r) => r.slug).includes(`${P}-zed`)) ? ok("archived destination excluded from switcher list") : bad("archived destination leaked into switcher list");

    // ── 12. PLATFORM_ADMIN ACCESS (sees all, incl. drafts of other dests) ──────
    const adminSees = await u.admin.c.from("destinations").select("id").eq("id", id);
    (adminSees.data?.length === 1) ? ok("platform_admin can read any destination") : bad("admin cannot read destination");

    // ── 13. HOTEL-ROLE DENIAL ──────────────────────────────────────────────────
    const hIns = await u.hotel.c.from("destinations").insert({ name: "X", slug: `${P}-hotelx`, timezone: "Europe/Zagreb", default_locale: "en" });
    denied(hIns) ? ok("hotel role CANNOT insert a destination") : bad("hotel role inserted a destination!");
    const hUpd = await u.hotel.c.from("destinations").update({ name: "hack" }).eq("id", dCtx.data.id).select("id");
    (denied(hUpd) || (hUpd.data || []).length === 0) ? ok("hotel role CANNOT update a destination") : bad("hotel role updated a destination!");
    const hPub = await u.hotel.c.rpc("publish_destination", { p_destination: dCtx.data.id, p_change_summary: "x" });
    denied(hPub) ? ok("hotel role CANNOT publish_destination") : bad("hotel role published a destination!");
    const hHist = await u.hotel.c.rpc("list_destination_versions", { p_destination: dCtx.data.id });
    denied(hHist) ? ok("hotel role CANNOT read destination history") : bad("hotel role read destination history!");

    // ── 14. ANON DENIAL ────────────────────────────────────────────────────────
    const aSel = await anon.from("destinations").select("id").limit(1);
    ((aSel.data || []).length === 0) ? ok("anon cannot read destinations (RLS)") : bad("anon read destinations!");
    const aPub = await anon.rpc("publish_destination", { p_destination: dCtx.data.id, p_change_summary: "x" });
    denied(aPub) ? ok("anon cannot execute publish_destination") : bad("anon executed publish_destination!");

    // ── 15. RLS CROSS-VISIBILITY: hotel user can't see an unrelated draft ──────
    const hotelSeesForeign = await u.hotel.c.from("destinations").select("id").eq("id", id);   // id is draft, unrelated to hotel
    ((hotelSeesForeign.data || []).length === 0) ? ok("hotel role cannot see an unrelated draft destination (RLS)") : bad("hotel role saw an unrelated draft!");
    const hotelSeesCtx = await u.hotel.c.from("destinations").select("id").eq("id", dCtx.data.id);   // their own destination
    ((hotelSeesCtx.data || []).length === 1) ? ok("hotel role CAN see its own linked destination") : bad("hotel role cannot see its linked destination");

    // ── 16. NO HARD DELETE ─────────────────────────────────────────────────────
    const delTry = await u.admin.c.from("destinations").delete().eq("id", id).select("id");
    const stillThere = (await svc.from("destinations").select("id").eq("id", id)).data?.length === 1;
    ((denied(delTry) || (delTry.data || []).length === 0) && stillThere) ? ok("no hard delete — DELETE is a no-op (archive-only)") : bad("destination was hard-deleted!");
    const delPol = (await q(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destinations' and cmd='DELETE'`)).rows[0].c;
    (delPol === 0) ? ok("no DELETE policy exists on destinations") : bad("a DELETE policy exists on destinations");

    // ── 17. NO REGRESSION: Split destination + Antique linkage intact ──────────
    const split = (await svc.from("destinations").select("id,status,published_snapshot").eq("slug", "split").maybeSingle()).data;
    (split && split.status === "published" && split.published_snapshot) ? ok("existing Split destination intact (published + live snapshot)") : bad("Split destination regressed");
    if (split) {
      const linked = (await svc.from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", split.id)).count;
      (linked >= 1) ? ok(`Split still has ${linked} hotel(s) linked (Antique linkage intact)`) : bad("Split lost its hotel linkage");
    }

  } finally {
    await cleanup();
    await sql.end();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Destinations regression: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

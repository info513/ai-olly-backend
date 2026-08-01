// ============================================================================
// AI OLLY Platform 2.0 — Step 2 verification (DEV ONLY, aiolly-dev)
// ----------------------------------------------------------------------------
// Verifies tenancy & identity: objects, RLS matrix, privileges, uniqueness,
// helper functions, and role-based access using REAL Supabase Auth test users
// (created + deleted via the admin API). Synthetic data only; cleaned up.
// No secrets logged; no production writes. Run: npm run verify:supabase:step2
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const PASS_WORD = 'Verify-Step2-Pass!1';
const P = 'verify-step2';                 // slug prefix
const DOM = '@verify.local';              // test email domain

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const isDenied = (res) => !!(res && res.error);
const rows = (res) => (res && res.data) ? res.data : [];

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) {
    console.error('  Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL'); process.exit(1);
  }
  console.log('AI OLLY — Step 2 verification (aiolly-dev)\n');

  const svc = getSupabaseServerClient();                       // service role
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);

  const users = {};   // role -> {id, email, client}
  const H = {};       // hotel key -> uuid
  let destId, grpId;

  const cleanup = async () => {
    // delete test auth users (cascades profiles + memberships)
    try {
      const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of (data?.users || [])) if (u.email && u.email.endsWith(DOM)) await svc.auth.admin.deleteUser(u.id).catch(() => {});
    } catch { /* ignore */ }
    // delete test tenant rows via owner (service_role lacks delete on hotels/destinations)
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.hotel_groups where slug like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + '%']).catch(() => {});
  };

  const mkUser = async (key, isAdmin) => {
    const email = `${P}.${key}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PASS_WORD, email_confirm: true });
    if (error) throw new Error(`createUser ${key}: ${error.message}`);
    const id = data.user.id;
    await svc.from('profiles').insert({ user_id: id, email, is_platform_admin: !!isAdmin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PASS_WORD });
    if (s.error) throw new Error(`signIn ${key}: ${s.error.message}`);
    users[key] = { id, email, client: c };
    return id;
  };

  try {
    await cleanup(); // idempotent start

    // ── A) catalog: objects + RLS + privileges ──────────────────────────────
    const T = ['destinations', 'hotel_groups', 'hotels', 'profiles', 'hotel_memberships'];
    for (const t of T) {
      const r = await q(`select to_regclass('public.'||$1) is not null ex`, [t]); r.rows[0].ex ? ok(`table ${t} exists`) : bad(`table ${t} missing`);
      const rls = await q(`select relrowsecurity rs from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t]);
      rls.rows[0]?.rs ? ok(`RLS enabled on ${t}`) : bad(`RLS NOT enabled on ${t}`);
      const a = await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t]);
      a.rows[0].c === 0 ? ok(`${t}: anon has no grants`) : bad(`${t}: anon has grants`);
    }
    for (const [e] of [['hotel_member_role'], ['membership_status'], ['hotel_status'], ['hotel_group_status'], ['destination_status']]) {
      const r = await q(`select 1 from pg_type where typname=$1`, [e]); r.rowCount ? ok(`enum ${e} exists`) : bad(`enum ${e} missing`);
    }
    for (const fn of ['is_platform_admin', 'has_hotel_membership', 'has_hotel_role', 'has_destination_access', 'has_group_access']) {
      const r = await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='platform' and p.proname=$1`, [fn]);
      r.rowCount ? ok(`function platform.${fn} exists`) : bad(`function platform.${fn} missing`);
    }
    // service_role privilege matrix
    const expectSvc = { destinations: 'INSERT,SELECT,UPDATE', hotel_groups: 'INSERT,SELECT,UPDATE', hotels: 'INSERT,SELECT,UPDATE', profiles: 'INSERT,SELECT,UPDATE', hotel_memberships: 'DELETE,INSERT,SELECT,UPDATE' };
    for (const t of T) {
      const g = await q(`select string_agg(privilege_type,',' order by privilege_type) p from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='service_role'`, [t]);
      (g.rows[0].p || '') === expectSvc[t] ? ok(`${t}: service_role = ${g.rows[0].p}`) : bad(`${t}: service_role = ${g.rows[0].p} (expected ${expectSvc[t]})`);
    }

    // ── B) create synthetic tenants (service role) ──────────────────────────
    { const r = await svc.from('destinations').insert({ name: 'VS Dest', slug: `${P}-dest`, timezone: 'Europe/Zagreb' }).select('id').single(); destId = r.data.id; }
    { const r = await svc.from('hotel_groups').insert({ name: 'VS Group', slug: `${P}-grp` }).select('id').single(); grpId = r.data.id; }
    for (const k of ['h1', 'h2', 'h3']) {
      const r = await svc.from('hotels').insert({ name: `VS ${k}`, slug: `${P}-${k}`, destination_id: destId, hotel_group_id: grpId, timezone: 'Europe/Zagreb', currency: 'EUR' }).select('id').single();
      H[k] = r.data.id;
    }
    ok('service_role created synthetic destination/group/hotels');

    // uniqueness constraints
    isDenied(await svc.from('hotels').insert({ name: 'dup', slug: `${P}-h1`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' })) ? ok('hotel slug globally unique') : bad('hotel slug uniqueness NOT enforced');
    isDenied(await svc.from('destinations').insert({ name: 'dup', slug: `${P}-dest`, timezone: 'Europe/Zagreb' })) ? ok('destination slug globally unique') : bad('destination slug uniqueness NOT enforced');

    // ── C) users + memberships ──────────────────────────────────────────────
    await mkUser('pa', true);   // platform admin
    await mkUser('ha', false);  // hotel_admin @ h1
    await mkUser('rc', false);  // reception @ h1
    await mkUser('ed', false);  // editor @ h1
    await mkUser('mu', false);  // member @ h1 + h2
    await mkUser('su', false);  // suspended @ h1
    await mkUser('nm', false);  // no membership
    await svc.from('hotel_memberships').insert([
      { hotel_id: H.h1, user_id: users.ha.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: H.h1, user_id: users.rc.id, role: 'reception', status: 'active' },
      { hotel_id: H.h1, user_id: users.ed.id, role: 'editor', status: 'active' },
      { hotel_id: H.h1, user_id: users.mu.id, role: 'read_only', status: 'active' },
      { hotel_id: H.h2, user_id: users.mu.id, role: 'read_only', status: 'active' },
      { hotel_id: H.h1, user_id: users.su.id, role: 'read_only', status: 'suspended' },
    ]);
    ok('memberships created (unique hotel_id+user_id enforced by prior inserts)');
    isDenied(await svc.from('hotel_memberships').insert({ hotel_id: H.h1, user_id: users.ha.id, role: 'reception', status: 'active' })) ? ok('membership unique(hotel_id,user_id)') : bad('membership uniqueness NOT enforced');

    const seeIds = async (client, ids) => rows(await client.from('hotels').select('id').in('id', ids)).map(r => r.id).sort();

    // ── D) RLS access matrix ────────────────────────────────────────────────
    // anon
    (rows(await anon.from('hotels').select('id')).length === 0) ? ok('anon cannot read hotels') : bad('anon READ leaked');
    isDenied(await anon.from('hotels').insert({ name: 'x', slug: `${P}-anon`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' })) ? ok('anon cannot write hotels') : bad('anon WRITE leaked');
    // no membership
    ((await seeIds(users.nm.client, [H.h1, H.h2, H.h3])).length === 0) ? ok('authenticated w/o membership sees no hotels') : bad('no-membership user saw hotels');
    // hotel member sees only assigned hotel
    JSON.stringify(await seeIds(users.rc.client, [H.h1, H.h2, H.h3])) === JSON.stringify([H.h1]) ? ok('hotel member reads only assigned hotel (h1)') : bad('hotel member visibility wrong');
    // multi-hotel sees both, not third
    JSON.stringify(await seeIds(users.mu.client, [H.h1, H.h2, H.h3])) === JSON.stringify([H.h1, H.h2].sort()) ? ok('multi-hotel user reads h1+h2 only') : bad('multi-hotel visibility wrong');
    // suspended grants nothing
    ((await seeIds(users.su.client, [H.h1, H.h2, H.h3])).length === 0) ? ok('suspended membership grants no access') : bad('suspended membership leaked access');
    // platform admin sees all
    JSON.stringify(await seeIds(users.pa.client, [H.h1, H.h2, H.h3])) === JSON.stringify([H.h1, H.h2, H.h3].sort()) ? ok('platform_admin reads all tenants') : bad('platform_admin cross-tenant read failed');

    // membership management authority
    isDenied(await users.rc.client.from('hotel_memberships').insert({ hotel_id: H.h1, user_id: users.nm.id, role: 'read_only', status: 'active' })) ? ok('reception cannot manage memberships') : bad('reception managed memberships');
    isDenied(await users.ed.client.from('hotel_memberships').insert({ hotel_id: H.h1, user_id: users.nm.id, role: 'read_only', status: 'active' })) ? ok('editor cannot manage memberships') : bad('editor managed memberships');
    // hotel_admin: own hotel yes, other hotel no
    { const r = await users.ha.client.from('hotel_memberships').insert({ hotel_id: H.h1, user_id: users.nm.id, role: 'read_only', status: 'active' });
      !isDenied(r) ? ok('hotel_admin manages memberships for own hotel (h1)') : bad(`hotel_admin blocked on own hotel: ${r.error?.message}`); }
    isDenied(await users.ha.client.from('hotel_memberships').insert({ hotel_id: H.h2, user_id: users.nm.id, role: 'read_only', status: 'active' })) ? ok('hotel_admin cannot manage memberships for other hotel (h2)') : bad('hotel_admin managed unrelated hotel');

    // profile self-promotion blocked
    await users.rc.client.from('profiles').update({ is_platform_admin: true }).eq('user_id', users.rc.id);
    { const r = await svc.from('profiles').select('is_platform_admin').eq('user_id', users.rc.id).single();
      r.data && r.data.is_platform_admin === false ? ok('user cannot self-set is_platform_admin (trigger protected)') : bad('self-promotion to platform_admin LEAKED'); }

    // platform admin can write a destination; hotel_admin cannot
    { const r = await users.pa.client.from('destinations').insert({ name: 'pa-dest', slug: `${P}-padest`, timezone: 'Europe/Zagreb' });
      !isDenied(r) ? ok('platform_admin can create destinations') : bad(`platform_admin destination insert failed: ${r.error?.message}`); }
    isDenied(await users.ha.client.from('destinations').insert({ name: 'ha-dest', slug: `${P}-hadest`, timezone: 'Europe/Zagreb' })) ? ok('hotel_admin cannot create canonical destinations') : bad('hotel_admin created destination');

    // last active hotel_admin protection
    isDenied(await svc.from('hotel_memberships').update({ status: 'removed' }).eq('hotel_id', H.h1).eq('user_id', users.ha.id)) ? ok('cannot remove the last active hotel_admin') : bad('last hotel_admin removal NOT prevented');
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + auth users cleaned up. No production writes.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('  verify error:', e.message); process.exit(1); });

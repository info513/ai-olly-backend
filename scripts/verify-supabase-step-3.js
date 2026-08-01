// ============================================================================
// AI OLLY Platform 2.0 — Step 3 verification (DEV ONLY, aiolly-dev)
// ----------------------------------------------------------------------------
// Rooms & Room Guide (Pattern C): objects, RLS, inheritance resolution, override
// semantics, token protection, column protection. Real Auth test users; cleaned
// up. No secrets/tokens logged; no production writes. npm run verify:supabase:step3
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = 'Verify-Step3-Pass!1';
const P = 'vs3', DOM = '@verify.local';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const denied = (r) => !!(r && r.error);
const data = (r) => (r && r.data) ? r.data : [];

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) { console.error('  Missing env'); process.exit(1); }
  console.log('AI OLLY — Step 3 verification (aiolly-dev)\n');
  const svc = getSupabaseServerClient();
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const users = {}, RT = {}, R = {}, HT = {};
  let destId;

  const cleanup = async () => {
    try { const { data: u } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 }); for (const x of (u?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.rooms where access_token like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.room_types where slug like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + '%']).catch(() => {});
  };
  const mkUser = async (k, admin) => {
    const email = `${P}.${k}${DOM}`;
    const { data: d, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from('profiles').insert({ user_id: d.user.id, email, is_platform_admin: !!admin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signIn ${k}: ${s.error.message}`);
    users[k] = { id: d.user.id, client: c };
  };
  const resolved = async (room_id) => (await svc.from('resolved_rooms').select('*').eq('room_id', room_id).single()).data;

  try {
    await cleanup();

    // A) catalog
    for (const t of ['room_types', 'rooms']) {
      (await q(`select to_regclass('public.'||$1) ex`, [t])).rows[0].ex ? ok(`table ${t} exists`) : bad(`table ${t} missing`);
      (await q(`select relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0]?.r ? ok(`RLS on ${t}`) : bad(`RLS OFF ${t}`);
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c === 0 ? ok(`${t}: anon no grants`) : bad(`${t}: anon grants leaked`);
    }
    (await q(`select to_regclass('public.resolved_rooms') ex`)).rows[0].ex ? ok('view resolved_rooms exists') : bad('resolved_rooms missing');
    for (const fn of ['check_room_type_same_hotel', 'normalize_room_overrides', 'protect_room_columns', 'get_room_access_token'])
      (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='platform' and p.proname=$1`, [fn])).rowCount ? ok(`function platform.${fn}`) : bad(`function ${fn} missing`);
    // authenticated must NOT have SELECT on rooms.access_token
    (await q(`select count(*)::int c from information_schema.column_privileges where table_schema='public' and table_name='rooms' and column_name='access_token' and privilege_type='SELECT' and grantee in ('authenticated','anon')`)).rows[0].c === 0
      ? ok('access_token: no column SELECT for anon/authenticated') : bad('access_token column SELECT leaked');

    // B) fixtures
    destId = (await svc.from('destinations').insert({ name: 'VS3', slug: `${P}-dest`, timezone: 'Europe/Zagreb' }).select('id').single()).data.id;
    HT.h1 = (await svc.from('hotels').insert({ name: 'H1', slug: `${P}-h1`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' }).select('id').single()).data.id;
    HT.h2 = (await svc.from('hotels').insert({ name: 'H2', slug: `${P}-h2`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' }).select('id').single()).data.id;
    RT.deluxe = (await svc.from('room_types').insert({ hotel_id: HT.h1, name: 'Deluxe', slug: `${P}-deluxe`, smart_glass: true, underfloor_heating: true, room_features: ['King bed', 'Minibar'], ai_welcome: 'DEFAULT WELCOME' }).select('id').single()).data.id;
    RT.std = (await svc.from('room_types').insert({ hotel_id: HT.h1, name: 'Standard', slug: `${P}-standard`, smart_glass: false, underfloor_heating: false, room_features: ['Queen bed'], ai_welcome: 'STD WELCOME' }).select('id').single()).data.id;
    RT.h2 = (await svc.from('room_types').insert({ hotel_id: HT.h2, name: 'H2T', slug: `${P}-h2t`, smart_glass: true }).select('id').single()).data.id;
    const mkRoom = async (key, hotel, type, num, extra) => { R[key] = (await svc.from('rooms').insert({ hotel_id: hotel, room_type_id: type, room_number: num, access_token: `${P}-tok-${num}`, ...extra }).select('id').single()).data.id; };
    await mkRoom('inherit', HT.h1, RT.deluxe, '101', {});
    await mkRoom('fover', HT.h1, RT.deluxe, '102', { smart_glass_override: false, ai_welcome_override: 'OVERRIDE WELCOME', room_features_override: ['Only this'], view_description_override: 'Sea view' });
    await mkRoom('empty', HT.h1, RT.deluxe, '103', { ai_welcome_override: '   ', room_features_override: [] });
    await mkRoom('stdinh', HT.h1, RT.std, '104', {});
    await mkRoom('truover', HT.h1, RT.std, '105', { smart_glass_override: true });
    await mkRoom('h2r', HT.h2, RT.h2, '201', {});
    ok('service_role created synthetic hotels/room_types/rooms');

    // C) constraints
    denied(await svc.from('rooms').insert({ hotel_id: HT.h1, room_type_id: RT.deluxe, room_number: '101', access_token: `${P}-tok-dup1` })) ? ok('room_number unique within hotel') : bad('room_number uniqueness NOT enforced');
    denied(await svc.from('rooms').insert({ hotel_id: HT.h1, room_type_id: RT.deluxe, room_number: '999', access_token: `${P}-tok-101` })) ? ok('access_token globally unique') : bad('access_token uniqueness NOT enforced');
    denied(await svc.from('room_types').insert({ hotel_id: HT.h1, name: 'dup', slug: `${P}-deluxe` })) ? ok('room_type slug unique within hotel') : bad('room_type slug uniqueness NOT enforced');
    denied(await svc.from('rooms').insert({ hotel_id: HT.h1, room_type_id: RT.h2, room_number: '888', access_token: `${P}-tok-x` })) ? ok('room_type must belong to same hotel as room') : bad('cross-hotel room_type NOT rejected');

    // D) inheritance / override resolution (via resolved_rooms)
    { const r = await resolved(R.inherit); (r.smart_glass === true && r.underfloor_heating === true && r.ai_welcome === 'DEFAULT WELCOME' && JSON.stringify(r.room_features) === JSON.stringify(['King bed', 'Minibar'])) ? ok('inherit: all defaults resolved') : bad(`inherit wrong: ${JSON.stringify(r)}`); }
    { const r = await resolved(R.fover); (r.smart_glass === false && r.view_description === 'Sea view' && JSON.stringify(r.room_features) === JSON.stringify(['Only this']) && r.ai_welcome === 'OVERRIDE WELCOME') ? ok('override: false-over-true + text + list replaced') : bad(`override wrong: ${JSON.stringify(r)}`); }
    { const r = await resolved(R.empty); (r.ai_welcome === 'DEFAULT WELCOME' && JSON.stringify(r.room_features) === JSON.stringify(['King bed', 'Minibar'])) ? ok('empty override normalized to inherit') : bad(`empty-override wrong: ${JSON.stringify(r)}`); }
    { const r = await resolved(R.stdinh); (r.smart_glass === false) ? ok('null override inherits (false stays false)') : bad(`null-inherit wrong: ${JSON.stringify(r.smart_glass)}`); }
    { const r = await resolved(R.truover); (r.smart_glass === true) ? ok('true overrides false') : bad(`true-over-false wrong: ${JSON.stringify(r.smart_glass)}`); }
    { const a = await resolved(R.fover), b = await resolved(R.fover); JSON.stringify(a) === JSON.stringify(b) ? ok('resolved context is deterministic') : bad('resolved context NOT deterministic'); }

    // E) users + memberships
    await mkUser('pa', true); await mkUser('ha'); await mkUser('rc'); await mkUser('ed'); await mkUser('ro'); await mkUser('mu'); await mkUser('su'); await mkUser('nm');
    await svc.from('hotel_memberships').insert([
      { hotel_id: HT.h1, user_id: users.ha.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: users.rc.id, role: 'reception', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ed.id, role: 'editor', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ro.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h1, user_id: users.mu.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h2, user_id: users.mu.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h1, user_id: users.su.id, role: 'read_only', status: 'suspended' },
    ]);

    const roomsSeen = async (client) => data(await client.from('rooms').select('id').in('id', [R.inherit, R.fover, R.h2r])).map(x => x.id).sort();

    // F) RLS access
    (data(await anon.from('rooms').select('id')).length === 0) ? ok('anon cannot read rooms') : bad('anon rooms leaked');
    (data(await anon.from('resolved_rooms').select('room_id')).length === 0) ? ok('anon cannot read resolved_rooms') : bad('anon resolved leaked');
    ((await roomsSeen(users.nm.client)).length === 0) ? ok('no-membership sees no rooms') : bad('no-membership leaked');
    JSON.stringify(await roomsSeen(users.rc.client)) === JSON.stringify([R.inherit, R.fover].sort()) ? ok('member reads only assigned hotel rooms') : bad('member room visibility wrong');
    JSON.stringify(await roomsSeen(users.mu.client)) === JSON.stringify([R.inherit, R.fover, R.h2r].sort()) ? ok('multi-hotel member reads both hotels') : bad('multi-hotel wrong');
    ((await roomsSeen(users.su.client)).length === 0) ? ok('suspended membership sees no rooms') : bad('suspended leaked');
    (data(await users.pa.client.from('rooms').select('id').eq('id', R.h2r)).length === 1) ? ok('platform_admin cross-hotel access') : bad('platform_admin cross-hotel failed');

    // G) token protection
    denied(await users.rc.client.from('rooms').select('access_token').limit(1)) ? ok('member cannot SELECT access_token (column-protected)') : bad('access_token READ leaked to member');
    denied(await users.rc.client.from('resolved_rooms').select('access_token').limit(1)) ? ok('resolved_rooms exposes no access_token') : bad('resolved_rooms token leaked');

    // H) write authority + column protection (read-after-write; rooms updates avoid
    //    RETURNING * which would hit the column-protected access_token).
    const updErr = async (client, table, patch, id) => (await client.from(table).update(patch).eq('id', id)).error?.message || null;
    const readRoom = async (id, cols) => (await svc.from('rooms').select(cols).eq('id', id).single()).data;
    const readRT = async (id, cols) => (await svc.from('room_types').select(cols).eq('id', id).single()).data;

    await updErr(users.ro.client, 'rooms', { floor: 7 }, R.stdinh);
    ((await readRoom(R.stdinh, 'floor')).floor !== 7) ? ok('read_only cannot write rooms') : bad('read_only wrote rooms');
    await updErr(users.rc.client, 'rooms', { floor: 6 }, R.stdinh);
    ((await readRoom(R.stdinh, 'floor')).floor !== 6) ? ok('reception cannot write rooms') : bad('reception wrote rooms');

    { const e = await updErr(users.ed.client, 'rooms', { ai_welcome_override: 'ED SET', room_number: '900', hotel_id: HT.h2 }, R.fover);
      const r = await readRoom(R.fover, 'ai_welcome_override, room_number, hotel_id');
      (r.ai_welcome_override === 'ED SET' && r.room_number === '102' && r.hotel_id === HT.h1)
        ? ok('editor edits content but not room_number/hotel_id (trigger-protected)')
        : bad(`editor content/protection wrong: ${JSON.stringify(r)}${e ? ' err=' + e : ''}`); }

    { const e = await updErr(users.ha.client, 'rooms', { floor: 5 }, R.inherit);
      ((await readRoom(R.inherit, 'floor')).floor === 5) ? ok('hotel_admin updates own-hotel room') : bad(`hotel_admin own-hotel update failed${e ? ' err=' + e : ''}`); }
    await updErr(users.ha.client, 'rooms', { floor: 9 }, R.h2r);
    ((await readRoom(R.h2r, 'floor')).floor !== 9) ? ok('hotel_admin cannot update other-hotel room') : bad('hotel_admin updated unrelated hotel');

    denied(await users.ha.client.from('rooms').select('access_token').limit(1)) ? ok('hotel_admin cannot SELECT raw access_token') : bad('hotel_admin token READ leaked');

    { const e = await updErr(users.ed.client, 'room_types', { description: 'edx' }, RT.deluxe);
      ((await readRT(RT.deluxe, 'description')).description === 'edx') ? ok('editor can manage room_types (own hotel)') : bad(`editor room_type update failed${e ? ' err=' + e : ''}`); }
    await updErr(users.ro.client, 'room_types', { description: 'rox' }, RT.deluxe);
    ((await readRT(RT.deluxe, 'description')).description !== 'rox') ? ok('read_only cannot write room_types') : bad('read_only wrote room_types');
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + auth users cleaned up. No tokens logged; no production writes.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('  verify error:', e.message); process.exit(1); });

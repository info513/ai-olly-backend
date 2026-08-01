// ============================================================================
// AI OLLY Platform 2.0 — Step 4 verification (DEV ONLY, aiolly-dev)
// ----------------------------------------------------------------------------
// Hotel Services & operational content: objects, RLS, tenant isolation, Pattern A
// platform-default -> hotel-override resolution, visibility flags, validity
// windows, publishing/versioning, critical acknowledgement, rollback, column
// protection, audit. Real Auth test users; cleaned up. No secrets logged; no
// production writes. Run: npm run verify:supabase:step4
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = 'Verify-Step4-Pass!1';
const P = 'vs4', DOM = '@verify.local';
const BODY = (t) => ({ version: 1, blocks: [{ type: 'paragraph', text: t }] });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const denied = (r) => !!(r && r.error);
const data = (r) => (r && r.data) ? r.data : [];

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) { console.error('  Missing env'); process.exit(1); }
  console.log('AI OLLY — Step 4 verification (aiolly-dev)\n');
  const svc = getSupabaseServerClient();
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const users = {}, HT = {}, CAT = {}, S = {};

  const cleanup = async () => {
    try { const { data: u } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 }); for (const x of (u?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='hotel_service' and entity_id in (select id from public.hotel_services where key like $1)`, [P + '%']).catch(() => {});
    await q(`delete from public.audit_log where entity_type in ('hotel_service','service_category','hotel_service_settings') and hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    await q(`delete from public.hotel_service_settings where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    await q(`delete from public.hotel_services where key like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.service_categories where key like $1`, [P + '%']).catch(() => {});
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
  const mkSvc = async (key, row) => { S[key] = (await svc.from('hotel_services').insert({ key: `${P}-${key}`, ...row }).select('id').single()).data?.id; if (!S[key]) throw new Error(`mkSvc ${key} failed`); };
  const readSvc = async (id, cols) => (await svc.from('hotel_services').select(cols).eq('id', id).single()).data;
  const resolved = async (hotel) => data(await svc.rpc('resolved_hotel_services', { p_hotel: hotel }));

  try {
    await cleanup();

    // ── A) catalog ───────────────────────────────────────────────────────────
    for (const t of ['service_categories', 'hotel_services', 'hotel_service_settings']) {
      (await q(`select to_regclass('public.'||$1) ex`, [t])).rows[0].ex ? ok(`table ${t} exists`) : bad(`table ${t} missing`);
      (await q(`select relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0]?.r ? ok(`RLS on ${t}`) : bad(`RLS OFF ${t}`);
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c === 0 ? ok(`${t}: anon no grants`) : bad(`${t}: anon grants leaked`);
    }
    (await q(`select 1 from pg_type where typname='service_source_type'`)).rowCount ? ok('enum service_source_type') : bad('enum missing');
    for (const [sch, fn] of [['public', 'publish_hotel_service'], ['public', 'rollback_hotel_service'], ['public', 'resolved_hotel_services'], ['platform', 'is_valid_service_body'], ['platform', 'has_any_membership']])
      (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2`, [sch, fn])).rowCount ? ok(`function ${sch}.${fn}`) : bad(`function ${sch}.${fn} missing`);

    // ── B) fixtures (service_role bypasses RLS) ────────────────────────────────
    const destId = (await svc.from('destinations').insert({ name: 'VS4', slug: `${P}-dest`, timezone: 'Europe/Zagreb' }).select('id').single()).data.id;
    HT.h1 = (await svc.from('hotels').insert({ name: 'H1', slug: `${P}-h1`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' }).select('id').single()).data.id;
    HT.h2 = (await svc.from('hotels').insert({ name: 'H2', slug: `${P}-h2`, destination_id: destId, timezone: 'Europe/Zagreb', currency: 'EUR' }).select('id').single()).data.id;
    CAT.plat = (await svc.from('service_categories').insert({ hotel_id: null, key: `${P}-policies`, name: 'Policies' }).select('id').single()).data.id;
    CAT.h1 = (await svc.from('service_categories').insert({ hotel_id: HT.h1, key: `${P}-hcat`, name: 'H1 Cat' }).select('id').single()).data.id;
    CAT.h2 = (await svc.from('service_categories').insert({ hotel_id: HT.h2, key: `${P}-h2cat`, name: 'H2 Cat' }).select('id').single()).data.id;

    const nowMinus = (d) => new Date(Date.now() - d * 864e5).toISOString();
    const nowPlus = (d) => new Date(Date.now() + d * 864e5).toISOString();
    await mkSvc('checkin', { hotel_id: null, category_id: CAT.plat, title: 'Check-in', body_content: BODY('platform check-in'), status: 'published', is_critical: true, visible_in_pwa: true, visible_in_web: true, available_to_ai: true, published_at: nowMinus(1) });
    await mkSvc('checkin-ov', { hotel_id: HT.h1, category_id: CAT.plat, title: 'Check-in H1', body_content: BODY('hotel override'), status: 'published', is_critical: true, override_of_service_id: S.checkin, visible_in_pwa: true, visible_in_web: true, available_to_ai: true, published_at: nowMinus(1) });
    await mkSvc('transfer', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Transfer', body_content: BODY('pwa+ai'), status: 'published', visible_in_pwa: true, visible_in_web: false, available_to_ai: true, sort_order: 30, published_at: nowMinus(1) });
    await mkSvc('aionly', { hotel_id: HT.h1, category_id: CAT.h1, title: 'AI notes', body_content: BODY('ai only'), status: 'published', visible_in_pwa: false, visible_in_web: false, available_to_ai: true, sort_order: 40, published_at: nowMinus(1) });
    await mkSvc('current', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Current', body_content: BODY('valid now'), status: 'published', valid_from: nowMinus(5), valid_to: nowPlus(5), published_at: nowMinus(1) });
    await mkSvc('future', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Future', body_content: BODY('not yet'), status: 'published', valid_from: nowPlus(5), published_at: nowMinus(1) });
    await mkSvc('expired', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Expired', body_content: BODY('past'), status: 'published', valid_to: nowMinus(1), published_at: nowMinus(2) });
    await mkSvc('draft', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Draft', body_content: BODY('draft'), status: 'draft' });
    await mkSvc('preview', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Preview', body_content: BODY('preview'), status: 'preview' });
    await mkSvc('archived', { hotel_id: HT.h1, category_id: CAT.h1, title: 'Archived', body_content: BODY('archived'), status: 'archived' });
    await mkSvc('h2svc', { hotel_id: HT.h2, category_id: CAT.h2, title: 'H2 svc', body_content: BODY('h2'), status: 'published', published_at: nowMinus(1) });
    await mkSvc('pubme', { hotel_id: HT.h1, category_id: CAT.h1, title: 'PubMe v1', body_content: BODY('draft to publish'), status: 'draft' });
    await mkSvc('critdraft', { hotel_id: HT.h1, category_id: CAT.h1, title: 'CritDraft', body_content: BODY('critical draft'), status: 'draft', is_critical: true });
    ok('service_role created synthetic categories/services');

    // ── C) structured body validation ──────────────────────────────────────────
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-badbody1`, title: 'bad', body_content: '<h1>raw</h1>' })) ? ok('raw/non-object body rejected') : bad('raw body accepted');
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-badbody2`, title: 'bad', body_content: { blocks: [{ text: 'no type' }] } })) ? ok('block without type rejected') : bad('typeless block accepted');
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-badbody3`, title: 'bad', body_content: { blocks: [{ type: 'iframe', src: 'x' }] } })) ? ok('unknown block type rejected') : bad('unknown block accepted');
    { const r = await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-goodbody`, title: 'good', body_content: { version: 1, blocks: [{ type: 'heading', level: 2, text: 'x' }, { type: 'price_list', items: [{ label: 'Room', price: '100' }] }] } }); !denied(r) ? ok('valid structured body accepted') : bad(`valid body rejected: ${r.error?.message}`); await q(`delete from public.hotel_services where key=$1`, [`${P}-goodbody`]); }

    // ── D) key uniqueness + relations ──────────────────────────────────────────
    denied(await svc.from('service_categories').insert({ hotel_id: null, key: `${P}-policies`, name: 'dup' })) ? ok('platform category key unique') : bad('platform cat key dup allowed');
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-transfer`, title: 'dup' })) ? ok('service key unique within hotel') : bad('service key dup within hotel allowed');
    { const r = await svc.from('hotel_services').insert({ hotel_id: HT.h2, category_id: CAT.h2, key: `${P}-transfer`, title: 'same key other hotel', body_content: BODY('x') }); !denied(r) ? ok('same key allowed across different hotels') : bad('same key across hotels blocked'); await q(`delete from public.hotel_services where hotel_id=$1 and key=$2`, [HT.h2, `${P}-transfer`]); }
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h1, key: `${P}-badov`, title: 'x', body_content: BODY('x'), override_of_service_id: S.transfer })) ? ok('override target must be a platform default') : bad('override of non-default allowed');
    denied(await svc.from('hotel_services').insert({ hotel_id: null, category_id: CAT.plat, key: `${P}-platov`, title: 'x', body_content: BODY('x'), override_of_service_id: S.checkin })) ? ok('platform-default cannot be an override') : bad('platform override allowed');
    denied(await svc.from('hotel_services').insert({ hotel_id: HT.h1, category_id: CAT.h2, key: `${P}-xcat`, title: 'x', body_content: BODY('x') })) ? ok('service cannot use another hotel category') : bad('cross-hotel category allowed');
    denied(await svc.from('hotel_services').insert({ hotel_id: null, category_id: CAT.h1, key: `${P}-platcat`, title: 'x', body_content: BODY('x') })) ? ok('platform service must use platform category') : bad('platform svc with hotel category allowed');

    // ── E) users + memberships ─────────────────────────────────────────────────
    await mkUser('pa', true); await mkUser('ha'); await mkUser('ed'); await mkUser('rc'); await mkUser('ro'); await mkUser('mk'); await mkUser('su'); await mkUser('nm');
    await svc.from('hotel_memberships').insert([
      { hotel_id: HT.h1, user_id: users.ha.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ed.id, role: 'editor', status: 'active' },
      { hotel_id: HT.h1, user_id: users.rc.id, role: 'reception', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ro.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h1, user_id: users.mk.id, role: 'marketing', status: 'active' },
      { hotel_id: HT.h1, user_id: users.su.id, role: 'read_only', status: 'suspended' },
    ]);

    // ── F) RLS SELECT visibility ───────────────────────────────────────────────
    const seesH1 = async (c) => data(await c.from('hotel_services').select('id,status').eq('hotel_id', HT.h1)).map(x => x.status).sort();
    (data(await anon.from('hotel_services').select('id')).length === 0) ? ok('anon cannot read hotel_services') : bad('anon services leaked');
    (data(await anon.from('service_categories').select('id')).length === 0) ? ok('anon cannot read service_categories') : bad('anon categories leaked');
    ((await seesH1(users.nm.client)).length === 0) ? ok('no-membership sees no services') : bad('no-membership leaked');
    ((await seesH1(users.su.client)).length === 0) ? ok('suspended membership sees no services') : bad('suspended leaked');
    { const st = await seesH1(users.ed.client); (st.includes('draft') && st.includes('preview') && st.includes('archived') && st.includes('published')) ? ok('editor (author) sees ALL statuses') : bad(`editor status set wrong: ${st}`); }
    { const st = await seesH1(users.ha.client); (st.includes('draft') && st.includes('published')) ? ok('hotel_admin (author) sees drafts too') : bad(`hotel_admin status set wrong: ${st}`); }
    { const st = new Set(await seesH1(users.rc.client)); (st.has('published') && !st.has('draft') && !st.has('preview') && !st.has('archived')) ? ok('reception sees PUBLISHED only') : bad(`reception status set wrong: ${[...st]}`); }
    { const st = new Set(await seesH1(users.ro.client)); (st.has('published') && !st.has('draft')) ? ok('read_only sees PUBLISHED only') : bad(`read_only status set wrong: ${[...st]}`); }
    { const st = new Set(await seesH1(users.mk.client)); (st.has('published') && !st.has('draft')) ? ok('marketing sees PUBLISHED only (read-only R1)') : bad(`marketing status set wrong: ${[...st]}`); }
    (data(await users.rc.client.from('hotel_services').select('id').eq('id', S.checkin)).length === 1) ? ok('member reads published platform default') : bad('platform default not visible to member');
    (data(await users.pa.client.from('hotel_services').select('id').eq('id', S.h2svc)).length === 1) ? ok('platform_admin cross-hotel read') : bad('platform_admin cross-hotel failed');
    (data(await users.ed.client.from('hotel_services').select('id').eq('id', S.h2svc)).length === 0) ? ok('editor cannot read other-hotel services') : bad('editor cross-hotel leaked');

    // ── G) write authority + column protection ─────────────────────────────────
    const upd = async (c, patch, id) => (await c.from('hotel_services').update(patch).eq('id', id)).error?.message || null;
    await upd(users.ro.client, { title: 'RO' }, S.transfer);
    ((await readSvc(S.transfer, 'title')).title !== 'RO') ? ok('read_only cannot write services') : bad('read_only wrote service');
    await upd(users.rc.client, { title: 'RC' }, S.transfer);
    ((await readSvc(S.transfer, 'title')).title !== 'RC') ? ok('reception cannot write services') : bad('reception wrote service');
    await upd(users.mk.client, { title: 'MK' }, S.transfer);
    ((await readSvc(S.transfer, 'title')).title !== 'MK') ? ok('marketing cannot write services (R1 read-only)') : bad('marketing wrote service');

    { const e = await upd(users.ed.client, { title: 'ED TITLE', hotel_id: HT.h2, key: `${P}-hacked`, override_of_service_id: S.checkin, is_critical: true }, S.transfer);
      const r = await readSvc(S.transfer, 'title,hotel_id,key,override_of_service_id,is_critical');
      (r.title === 'ED TITLE' && r.hotel_id === HT.h1 && r.key === `${P}-transfer` && r.override_of_service_id === null && r.is_critical === false)
        ? ok('editor edits content but not tenancy/link/key/is_critical (trigger-protected)')
        : bad(`editor protection wrong: ${JSON.stringify(r)}${e ? ' err=' + e : ''}`); }

    { await upd(users.ha.client, { is_critical: true }, S.transfer);
      ((await readSvc(S.transfer, 'is_critical')).is_critical === true) ? ok('hotel_admin can toggle is_critical') : bad('hotel_admin could not set is_critical');
      await svc.from('hotel_services').update({ is_critical: false }).eq('id', S.transfer); } // reset for later resolved checks

    { const e = await upd(users.ed.client, { status: 'published' }, S.draft);
      ((await readSvc(S.draft, 'status')).status === 'draft' && e && /direct publish/i.test(e)) ? ok('direct status->published blocked (must use publish RPC)') : bad(`direct publish not blocked: status=${(await readSvc(S.draft, 'status')).status} err=${e}`); }

    await upd(users.ha.client, { title: 'H1ADMIN' }, S.h2svc);
    ((await readSvc(S.h2svc, 'title')).title !== 'H1ADMIN') ? ok('hotel_admin cannot edit other-hotel service') : bad('hotel_admin edited unrelated hotel');
    denied(await users.ha.client.from('hotel_services').update({ title: 'X' }).eq('id', S.checkin)) || ((await readSvc(S.checkin, 'title')).title === 'Check-in')
      ? ok('hotel users cannot edit platform-default service') : bad('platform default edited by hotel user');

    // editor can archive (not delete)
    await upd(users.ed.client, { status: 'archived' }, S.preview);
    ((await readSvc(S.preview, 'status')).status === 'archived') ? ok('editor can archive a service') : bad('editor could not archive');
    denied(await users.ha.client.from('hotel_services').delete().eq('id', S.archived)) ? ok('no hard delete of services (archive instead)') : bad('service hard-deleted');

    // platform category editable only by platform_admin
    const updCat = async (c, patch, id) => (await c.from('service_categories').update(patch).eq('id', id)).error?.message || null;
    await updCat(users.ed.client, { name: 'HACK' }, CAT.plat);
    ((await svc.from('service_categories').select('name').eq('id', CAT.plat).single()).data.name !== 'HACK') ? ok('hotel users cannot edit platform categories') : bad('platform category edited by hotel user');
    await updCat(users.ed.client, { name: 'H1CatEdited' }, CAT.h1);
    ((await svc.from('service_categories').select('name').eq('id', CAT.h1).single()).data.name === 'H1CatEdited') ? ok('editor can edit own-hotel category') : bad('editor could not edit own category');

    // ── H) publishing / versioning / critical / rollback ───────────────────────
    { const r = await users.ed.client.rpc('publish_hotel_service', { p_service: S.pubme, p_change_summary: 'v1' });
      const s = await readSvc(S.pubme, 'status,published_at');
      (!r.error && s.status === 'published' && s.published_at) ? ok('editor publish via RPC -> published + published_at set') : bad(`publish failed: ${r.error?.message}`); }
    { const v = (await q(`select count(*)::int c, max(version_number) mx from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pubme])).rows[0];
      (v.c === 1 && v.mx === 1) ? ok('publish created immutable content_version v1') : bad(`version row wrong: ${JSON.stringify(v)}`); }
    await svc.from('hotel_services').update({ title: 'PubMe v2', status: 'draft' }).eq('id', S.pubme);
    await users.ed.client.rpc('publish_hotel_service', { p_service: S.pubme, p_change_summary: 'v2' });
    { const v = (await q(`select count(*)::int c, max(version_number) mx from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pubme])).rows[0];
      (v.c === 2 && v.mx === 2) ? ok('second publish created v2 (append-only)') : bad(`v2 wrong: ${JSON.stringify(v)}`); }
    // critical publish requires acknowledgement
    { const r = await users.ha.client.rpc('publish_hotel_service', { p_service: S.critdraft });
      (r.error && /critical/i.test(r.error.message)) ? ok('critical publish without ack rejected') : bad(`critical no-ack not rejected: ${r.error?.message}`); }
    { const r = await users.ed.client.rpc('publish_hotel_service', { p_service: S.critdraft });
      (r.error && /critical/i.test(r.error.message)) ? ok('editor cannot bypass critical acknowledgement') : bad('editor bypassed critical ack'); }
    { const r = await users.ha.client.rpc('publish_hotel_service', { p_service: S.critdraft, p_acknowledge_critical: true });
      const s = await readSvc(S.critdraft, 'status,last_critical_ack_at,last_critical_ack_by');
      (!r.error && s.status === 'published' && s.last_critical_ack_at && s.last_critical_ack_by === users.ha.id) ? ok('critical publish with ack -> published + ack recorded') : bad(`critical ack publish wrong: ${JSON.stringify(s)} err=${r.error?.message}`); }
    // non-author cannot publish
    { const r = await users.rc.client.rpc('publish_hotel_service', { p_service: S.draft });
      (r.error && /privilege/i.test(r.error.message)) ? ok('reception cannot publish (insufficient privilege)') : bad('reception published'); }
    // rollback: publish v1 title, change to v2, rollback to v1 snapshot -> draft with v1 content
    { const v1 = (await q(`select id from public.content_versions where entity_type='hotel_service' and entity_id=$1 and version_number=1`, [S.pubme])).rows[0].id;
      const r = await users.ed.client.rpc('rollback_hotel_service', { p_service: S.pubme, p_version: v1 });
      const s = await readSvc(S.pubme, 'title,status');
      (!r.error && s.title === 'PubMe v1' && s.status === 'draft') ? ok('rollback restores prior snapshot as new DRAFT') : bad(`rollback wrong: ${JSON.stringify(s)} err=${r.error?.message}`);
      const still = (await q(`select count(*)::int c from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pubme])).rows[0].c;
      (still === 2) ? ok('rollback did not mutate/delete historical versions') : bad(`historical versions altered: ${still}`); }
    // content_versions immutable
    denied(await svc.from('content_versions').update({ change_summary: 'x' }).eq('entity_type', 'hotel_service').eq('entity_id', S.pubme)) ? ok('content_versions immutable (UPDATE denied)') : bad('content_versions mutable');

    // ── I) resolved model (Pattern A) ──────────────────────────────────────────
    // reset pubme/critdraft/preview so resolved(h1) is predictable; recompute live set
    const R1 = await resolved(HT.h1);
    const ids1 = R1.map(x => x.service_id);
    (ids1.includes(S['checkin-ov']) && !ids1.includes(S.checkin)) ? ok('override wins; overridden platform default excluded (no duplicate)') : bad('override/dedup wrong');
    (new Set(ids1).size === ids1.length) ? ok('no duplicate rows in resolved output') : bad('duplicate resolved rows');
    (!ids1.includes(S.draft) && !ids1.includes(S.archived) && !ids1.some(id => id === S.preview)) ? ok('draft/preview/archived excluded from resolved') : bad('non-live status leaked into resolved');
    (!ids1.includes(S.future) && !ids1.includes(S.expired) && ids1.includes(S.current)) ? ok('validity window respected (future/expired excluded, current included)') : bad('validity window wrong');
    { const ai = R1.find(x => x.service_id === S.aionly); (ai && ai.available_to_ai === true && ai.visible_in_pwa === false && ai.visible_in_web === false) ? ok('AI-only service resolved with independent visibility flags') : bad(`ai-only flags wrong: ${JSON.stringify(ai)}`); }
    { const tr = R1.find(x => x.service_id === S.transfer); (tr && tr.visible_in_pwa === true && tr.available_to_ai === true && tr.visible_in_web === false) ? ok('PWA+AI service flags independent in resolved') : bad(`transfer flags wrong: ${JSON.stringify(tr)}`); }
    { const ov = R1.find(x => x.service_id === S['checkin-ov']); (ov && ov.source === 'override') ? ok('resolved source labelled (override)') : bad(`source label wrong: ${JSON.stringify(ov)}`); }
    (Object.keys(R1[0] || {}).every(k => !['created_by', 'updated_by', 'access_token'].includes(k))) ? ok('resolved exposes no authoring metadata') : bad('resolved leaked authoring metadata');
    // hidden-via-settings excludes the service
    await users.ha.client.from('hotel_service_settings').insert({ hotel_id: HT.h1, service_id: S.transfer, visible: false });
    { const R = await resolved(HT.h1); (!R.map(x => x.service_id).includes(S.transfer)) ? ok('hotel_service_settings.visible=false hides service from resolved') : bad('hidden service still resolved'); }
    // featured + sort override reflected
    await users.ha.client.from('hotel_service_settings').upsert({ hotel_id: HT.h1, service_id: S.aionly, visible: true, featured: true, sort_order_override: 1 });
    { const R = await resolved(HT.h1); const a = R.find(x => x.service_id === S.aionly); (a && a.featured === true && a.sort_order === 1) ? ok('settings featured + sort_order_override reflected in resolved') : bad(`settings presentation wrong: ${JSON.stringify(a)}`); }
    // platform default resolves for a hotel with no override (h2)
    { const R2 = await resolved(HT.h2); const c = R2.find(x => x.service_id === S.checkin); (c && c.source === 'platform') ? ok('un-overridden platform default resolves for other hotel (source platform)') : bad('platform default not resolved for h2'); }

    // ── J) settings write authority ────────────────────────────────────────────
    denied(await users.ro.client.from('hotel_service_settings').insert({ hotel_id: HT.h1, service_id: S.current, visible: false })) ? ok('read_only cannot write settings') : bad('read_only wrote settings');
    { const r = await users.ed.client.from('hotel_service_settings').upsert({ hotel_id: HT.h1, service_id: S.current, visible: true, featured: true }); !denied(r) ? ok('editor can write presentation settings') : bad(`editor settings write failed: ${r.error?.message}`); }

    // ── K) audit ───────────────────────────────────────────────────────────────
    { const a = (await q(`select action, count(*)::int c from public.audit_log where entity_type='hotel_service' and hotel_id=$1 group by action`, [HT.h1])).rows;
      const acts = new Set(a.map(x => x.action));
      (acts.has('publish') && acts.has('update') && acts.has('archive')) ? ok('audit_log recorded publish/update/archive for services') : bad(`audit actions missing: ${[...acts]}`); }
    { const c = (await q(`select count(*)::int c from public.audit_log where entity_type='hotel_service' and action='publish' and actor_type='user' and hotel_id=$1`, [HT.h1])).rows[0].c;
      (c >= 1) ? ok('publish audited with actor_type=user') : bad('publish not audited as user'); }
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + auth users cleaned up. No secrets logged; no production writes.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('  verify error:', e.message); process.exit(1); });

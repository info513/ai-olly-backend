// ============================================================================
// AI OLLY Platform 2.0 — Package A verification (Steps 5/6/7, DEV ONLY)
// ----------------------------------------------------------------------------
// Destination content (canonical), Presentation layer (Pattern B), Pricing
// (Pattern A). Objects, RLS, cross-tenant isolation, resolved models, inheritance,
// visibility, validity, publish/versioning, audit. Real Auth test users; cleaned
// up. No secrets logged; no production writes. Run: npm run verify:supabase:step567
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = 'Verify-Step567-Pass!1';
const P = 'vs5', DOM = '@verify.local';
const BODY = (t) => ({ version: 1, blocks: [{ type: 'paragraph', text: t }] });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const denied = (r) => !!(r && r.error);
const data = (r) => (r && r.data) ? r.data : [];
const ids = [];   // every created entity id (for audit/version cleanup)

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) { console.error('  Missing env'); process.exit(1); }
  console.log('AI OLLY — Package A (Steps 5/6/7) verification (aiolly-dev)\n');
  const svc = getSupabaseServerClient();
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const users = {}, D = {}, HT = {}, POI = {}, RT = {}, WH = {}, EV = {}, PC = {}, PI = {};

  const cleanup = async () => {
    try { const { data: u } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 }); for (const x of (u?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    if (ids.length) {
      await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
      await q(`delete from public.audit_log where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    }
    await q(`delete from public.audit_log where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    for (const t of ['hotel_poi_settings', 'hotel_route_settings', 'hotel_whisper_settings', 'hotel_event_settings'])
      await q(`delete from public.${t} where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    await q(`delete from public.price_items where key like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.price_categories where key like $1`, [P + '%']).catch(() => {});
    for (const t of ['destination_pois', 'destination_routes', 'destination_whispers', 'destination_events'])
      await q(`delete from public.${t} where key like $1`, [P + '%']).catch(() => {});
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
  const ins = async (table, row) => { const r = await svc.from(table).insert(row).select('id').single(); if (r.error) throw new Error(`ins ${table}: ${r.error.message}`); ids.push(r.data.id); return r.data.id; };

  try {
    await cleanup();

    // ── A) catalog ─────────────────────────────────────────────────────────────
    const TABLES = ['destination_pois', 'destination_routes', 'destination_whispers', 'destination_events',
      'hotel_poi_settings', 'hotel_route_settings', 'hotel_whisper_settings', 'hotel_event_settings',
      'price_categories', 'price_items'];
    for (const t of TABLES) {
      (await q(`select to_regclass('public.'||$1) ex`, [t])).rows[0].ex ? ok(`table ${t} exists`) : bad(`table ${t} missing`);
      (await q(`select relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0]?.r ? ok(`RLS on ${t}`) : bad(`RLS OFF ${t}`);
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c === 0 ? ok(`${t}: anon no grants`) : bad(`${t}: anon grants leaked`);
    }
    for (const ty of ['poi_category', 'route_difficulty', 'price_billing_unit'])
      (await q(`select 1 from pg_type where typname=$1`, [ty])).rowCount ? ok(`enum ${ty}`) : bad(`enum ${ty} missing`);
    for (const fn of ['publish_destination_content', 'resolved_destination_pois', 'resolved_destination_routes', 'resolved_destination_whispers', 'resolved_destination_events', 'publish_price_item', 'resolved_price_items'])
      (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rowCount ? ok(`function public.${fn}`) : bad(`function ${fn} missing`);

    // ── B) fixtures ────────────────────────────────────────────────────────────
    D.A = await ins('destinations', { name: 'DA', slug: `${P}-destA`, timezone: 'Europe/Zagreb' });
    D.B = await ins('destinations', { name: 'DB', slug: `${P}-destB`, timezone: 'Europe/Zagreb' });
    HT.h1 = await ins('hotels', { name: 'H1', slug: `${P}-h1`, destination_id: D.A, timezone: 'Europe/Zagreb', currency: 'EUR' });
    HT.h2 = await ins('hotels', { name: 'H2', slug: `${P}-h2`, destination_id: D.B, timezone: 'Europe/Zagreb', currency: 'EUR' });
    // canonical content in destination A
    POI.pub = await ins('destination_pois', { destination_id: D.A, key: `${P}-poi1`, name: 'Palace', category: 'landmark', body_content: BODY('palace'), status: 'published', published_at: new Date().toISOString(), sort_order: 10 });
    POI.draft = await ins('destination_pois', { destination_id: D.A, key: `${P}-poi2`, name: 'Draft POI', category: 'other', body_content: BODY('draft'), status: 'draft', sort_order: 20 });
    POI.hidden = await ins('destination_pois', { destination_id: D.A, key: `${P}-poi3`, name: 'Riva', category: 'landmark', body_content: BODY('riva'), status: 'published', published_at: new Date().toISOString(), sort_order: 30 });
    RT.pub = await ins('destination_routes', { destination_id: D.A, key: `${P}-route1`, name: 'Walk', difficulty: 'easy', distance_km: 2.5, status: 'published', published_at: new Date().toISOString() });
    WH.pub = await ins('destination_whispers', { destination_id: D.A, channel_key: 'food', key: `${P}-wh1`, title: 'Burek', body_content: BODY('burek'), status: 'published', published_at: new Date().toISOString() });
    EV.future = await ins('destination_events', { destination_id: D.A, key: `${P}-ev1`, title: 'Festival', starts_at: new Date(Date.now() + 20 * 864e5).toISOString(), ends_at: new Date(Date.now() + 60 * 864e5).toISOString(), status: 'published', published_at: new Date().toISOString() });
    EV.past = await ins('destination_events', { destination_id: D.A, key: `${P}-evpast`, title: 'Past', starts_at: new Date(Date.now() - 60 * 864e5).toISOString(), ends_at: new Date(Date.now() - 10 * 864e5).toISOString(), status: 'published', published_at: new Date().toISOString() });
    POI.draftPub = await ins('destination_pois', { destination_id: D.A, key: `${P}-poi4`, name: 'ToPublish', category: 'other', body_content: BODY('tp'), status: 'draft', sort_order: 40 });
    // canonical in destination B (for h2 resolved)
    POI.b = await ins('destination_pois', { destination_id: D.B, key: `${P}-poib`, name: 'B POI', category: 'other', body_content: BODY('b'), status: 'published', published_at: new Date().toISOString() });
    // pricing
    PC.plat = await ins('price_categories', { hotel_id: null, key: `${P}-cat`, name: 'Transfers' });
    PC.h1 = await ins('price_categories', { hotel_id: HT.h1, key: `${P}-hcat`, name: 'Extras' });
    PI.plat = await ins('price_items', { hotel_id: null, category_id: PC.plat, key: `${P}-transfer`, name: 'Transfer', amount: 40, currency: 'EUR', vat_rate: 25, vat_included: true, billing_unit: 'per_use', status: 'published', published_at: new Date().toISOString() });
    PI.ov = await ins('price_items', { hotel_id: HT.h1, key: `${P}-transfer`, name: 'Transfer H1', amount: 35, currency: 'EUR', vat_rate: 25, vat_included: true, billing_unit: 'per_use', status: 'published', override_of_price_item_id: PI.plat, published_at: new Date().toISOString() });
    PI.native = await ins('price_items', { hotel_id: HT.h1, category_id: PC.h1, key: `${P}-late`, name: 'Late checkout', amount: 20, currency: 'EUR', vat_rate: 25, vat_included: false, billing_unit: 'per_use', status: 'published', published_at: new Date().toISOString() });
    PI.draft = await ins('price_items', { hotel_id: HT.h1, category_id: PC.h1, key: `${P}-draftprice`, name: 'Draft price', amount: 10, currency: 'EUR', vat_rate: 25, status: 'draft' });
    PI.future = await ins('price_items', { hotel_id: HT.h1, category_id: PC.h1, key: `${P}-futureprice`, name: 'Future price', amount: 99, currency: 'EUR', vat_rate: 25, status: 'published', valid_from: new Date(Date.now() + 10 * 864e5).toISOString(), published_at: new Date().toISOString() });
    ok('service_role created synthetic destination/pricing fixtures');

    // ── C) constraints & relations ─────────────────────────────────────────────
    denied(await svc.from('destination_pois').insert({ destination_id: D.A, key: `${P}-poi1`, name: 'dup', body_content: BODY('x') })) ? ok('POI key unique per destination') : bad('POI key dup allowed');
    denied(await svc.from('destination_pois').insert({ destination_id: D.A, key: `${P}-badbody`, name: 'x', body_content: '<h1>raw</h1>' })) ? ok('POI rejects raw/non-block body') : bad('POI raw body accepted');
    denied(await svc.from('price_items').insert({ hotel_id: HT.h1, key: `${P}-badov`, name: 'x', amount: 1, override_of_price_item_id: PI.native })) ? ok('price override target must be a platform default') : bad('price override of non-default allowed');
    denied(await svc.from('price_items').insert({ hotel_id: null, key: `${P}-platov`, name: 'x', amount: 1, override_of_price_item_id: PI.plat })) ? ok('platform-default price cannot be an override') : bad('platform price override allowed');
    denied(await svc.from('price_items').insert({ hotel_id: HT.h1, category_id: PC.plat, key: `${P}-xcat`, name: 'x', amount: 1 })) ? bad('platform category on hotel price should be allowed') : ok('hotel price may use platform category');  // allowed -> not denied
    { const r = await svc.from('price_items').insert({ hotel_id: HT.h2, category_id: PC.h1, key: `${P}-xcat2`, name: 'x', amount: 1 }); denied(r) ? ok('price cannot use another hotel category') : bad('cross-hotel price category allowed'); await q(`delete from public.price_items where hotel_id=$1 and key=$2`, [HT.h2, `${P}-xcat2`]); }

    // ── D) users + memberships ─────────────────────────────────────────────────
    await mkUser('pa', true); await mkUser('ha'); await mkUser('ed'); await mkUser('ro'); await mkUser('h2a'); await mkUser('nm');
    await svc.from('hotel_memberships').insert([
      { hotel_id: HT.h1, user_id: users.ha.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ed.id, role: 'editor', status: 'active' },
      { hotel_id: HT.h1, user_id: users.ro.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h2, user_id: users.h2a.id, role: 'hotel_admin', status: 'active' },
    ]);

    // ── E) RLS — canonical destination content (Step 5) ────────────────────────
    (data(await anon.from('destination_pois').select('id')).length === 0) ? ok('anon cannot read canonical POIs') : bad('anon canonical leaked');
    (data(await users.ed.client.from('destination_pois').select('id').eq('id', POI.pub)).length === 1) ? ok('destination member reads published canonical') : bad('member cannot read published canonical');
    (data(await users.ed.client.from('destination_pois').select('id').eq('id', POI.draft)).length === 0) ? ok('draft canonical hidden from non-admin') : bad('draft canonical leaked');
    (data(await users.h2a.client.from('destination_pois').select('id').eq('id', POI.pub)).length === 0) ? ok('other-destination hotel cannot read canonical (cross-tenant isolation)') : bad('cross-destination canonical leaked');
    (data(await users.nm.client.from('destination_pois').select('id')).length === 0) ? ok('no-membership reads no canonical') : bad('no-membership canonical leaked');
    (data(await users.pa.client.from('destination_pois').select('id').eq('id', POI.draft)).length === 1) ? ok('platform_admin reads canonical drafts') : bad('platform_admin canonical read failed');

    // canonical is platform-owned: hotel users cannot write it
    await users.ed.client.from('destination_pois').update({ name: 'HACK' }).eq('id', POI.pub);
    ((await svc.from('destination_pois').select('name').eq('id', POI.pub).single()).data.name === 'Palace') ? ok('hotel users cannot edit canonical content') : bad('canonical edited by hotel user');
    denied(await users.ed.client.from('destination_pois').insert({ destination_id: D.A, key: `${P}-edins`, name: 'x', body_content: BODY('x') })) ? ok('hotel users cannot create canonical content') : bad('hotel user created canonical');

    // ── F) publish / versioning — destination (Step 5) ─────────────────────────
    { const e = (await users.pa.client.from('destination_pois').update({ status: 'published' }).eq('id', POI.draftPub)).error?.message;
      const s = (await svc.from('destination_pois').select('status').eq('id', POI.draftPub).single()).data.status;
      (s === 'draft' && e && /direct publish/i.test(e)) ? ok('direct canonical publish blocked (use RPC)') : bad(`direct canonical publish not blocked: status=${s} err=${e}`); }
    { const r = await users.pa.client.rpc('publish_destination_content', { p_entity_type: 'destination_poi', p_entity_id: POI.draftPub, p_change_summary: 'v1' });
      const s = (await svc.from('destination_pois').select('status,published_at').eq('id', POI.draftPub).single()).data;
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='destination_poi' and entity_id=$1`, [POI.draftPub])).rows[0].c;
      (!r.error && s.status === 'published' && s.published_at && v === 1) ? ok('platform_admin publish_destination_content -> published + immutable version') : bad(`canonical publish wrong: ${JSON.stringify(s)} v=${v} err=${r.error?.message}`); }
    { const r = await users.ed.client.rpc('publish_destination_content', { p_entity_type: 'destination_poi', p_entity_id: POI.draft });
      (r.error && /platform_admin/i.test(r.error.message)) ? ok('non-admin cannot publish canonical content') : bad('non-admin published canonical'); }

    // ── G) Presentation layer (Step 6) ─────────────────────────────────────────
    // scope guard: cannot target content outside the hotel's destination
    denied(await users.ha.client.from('hotel_poi_settings').insert({ hotel_id: HT.h1, poi_id: POI.b, visible: true })) ? ok('presentation cannot target other-destination content') : bad('cross-destination presentation allowed');
    // read_only cannot write settings; editor can
    denied(await users.ro.client.from('hotel_poi_settings').insert({ hotel_id: HT.h1, poi_id: POI.pub, featured: true })) ? ok('read_only cannot write presentation settings') : bad('read_only wrote settings');
    { const r = await users.ha.client.from('hotel_poi_settings').insert({ hotel_id: HT.h1, poi_id: POI.pub, visible: true, featured: true, walking_time_minutes: 5, hotel_recommendation: 'Go early' }); !denied(r) ? ok('hotel_admin writes presentation settings') : bad(`hotel_admin settings write failed: ${r.error?.message}`); }
    await users.ed.client.from('hotel_poi_settings').insert({ hotel_id: HT.h1, poi_id: POI.hidden, visible: false });
    // resolved POIs for h1: overlays settings, hides hidden, excludes draft
    { const R = await data({ data: (await svc.rpc('resolved_destination_pois', { p_hotel: HT.h1 })).data });
      const p = R.find(x => x.poi_id === POI.pub);
      (p && p.featured === true && p.walking_time_minutes === 5 && p.hotel_recommendation === 'Go early') ? ok('resolved POIs overlay hotel presentation (featured/walking/recommendation)') : bad(`resolved overlay wrong: ${JSON.stringify(p)}`);
      (!R.map(x => x.poi_id).includes(POI.hidden)) ? ok('visible=false hides POI from resolved') : bad('hidden POI still resolved');
      (!R.map(x => x.poi_id).includes(POI.draft)) ? ok('draft canonical excluded from resolved') : bad('draft POI resolved');
      (p && p.name === 'Palace') ? ok('resolved keeps canonical name (no field-level merge)') : bad('canonical name altered in resolved'); }
    // canonical unchanged by presentation
    ((await svc.from('destination_pois').select('name').eq('id', POI.pub).single()).data.name === 'Palace') ? ok('presentation did not modify canonical row') : bad('canonical mutated by presentation');
    // resolved is destination-scoped: h2 (destB) sees only destB content
    { const R2 = (await svc.rpc('resolved_destination_pois', { p_hotel: HT.h2 })).data || [];
      (R2.map(x => x.poi_id).includes(POI.b) && !R2.map(x => x.poi_id).includes(POI.pub)) ? ok('resolved is destination-scoped per hotel') : bad('resolved leaked cross-destination'); }
    // resolved routes/whispers/events smoke + event validity
    { const R = (await svc.rpc('resolved_destination_routes', { p_hotel: HT.h1 })).data || []; R.some(x => x.route_id === RT.pub) ? ok('resolved routes returns published route') : bad('resolved routes missing'); }
    { const R = (await svc.rpc('resolved_destination_whispers', { p_hotel: HT.h1 })).data || []; R.some(x => x.whisper_id === WH.pub && x.channel_key === 'food') ? ok('resolved whispers returns published whisper w/ channel') : bad('resolved whispers wrong'); }
    { const R = (await svc.rpc('resolved_destination_events', { p_hotel: HT.h1 })).data || []; const idset = R.map(x => x.event_id); (idset.includes(EV.future) && !idset.includes(EV.past)) ? ok('resolved events includes upcoming, excludes past') : bad(`resolved events validity wrong: ${JSON.stringify(idset)}`); }
    // tenant safety: h2 admin resolving h1 -> RLS blocks hotel join (empty)
    { const R = (await users.h2a.client.rpc('resolved_destination_pois', { p_hotel: HT.h1 })).data || []; (R.length === 0) ? ok('resolved is tenant-safe (other-hotel admin gets nothing)') : bad('resolved cross-tenant leak'); }

    // ── H) Pricing (Step 7) ────────────────────────────────────────────────────
    // resolved pricing: override wins, dedup, net/gross, validity, published-only
    { const R = (await svc.rpc('resolved_price_items', { p_hotel: HT.h1 })).data || [];
      const idset = R.map(x => x.price_item_id);
      (idset.includes(PI.ov) && !idset.includes(PI.plat)) ? ok('price override wins; platform default excluded (no duplicate)') : bad('price override/dedup wrong');
      (new Set(idset).size === idset.length) ? ok('no duplicate rows in resolved pricing') : bad('duplicate resolved price rows');
      const ovr = R.find(x => x.price_item_id === PI.ov);
      (ovr && Number(ovr.amount) === 35 && Number(ovr.gross_amount) === 35 && Number(ovr.net_amount) === 28) ? ok('VAT-included price computes net=28.00 / gross=35.00') : bad(`vat-included calc wrong: ${JSON.stringify(ovr)}`);
      const nat = R.find(x => x.price_item_id === PI.native);
      (nat && Number(nat.net_amount) === 20 && Number(nat.gross_amount) === 25) ? ok('VAT-excluded price computes net=20.00 / gross=25.00') : bad(`vat-excluded calc wrong: ${JSON.stringify(nat)}`);
      (!idset.includes(PI.draft)) ? ok('draft price excluded from resolved') : bad('draft price resolved');
      (!idset.includes(PI.future)) ? ok('future-dated price excluded from resolved (validity)') : bad('future price resolved'); }
    // resolved for h2 (no override): platform default appears as source platform
    { const R = (await svc.rpc('resolved_price_items', { p_hotel: HT.h2 })).data || []; const c = R.find(x => x.price_item_id === PI.plat); (c && c.source === 'platform') ? ok('un-overridden platform price resolves for other hotel (source platform)') : bad('platform price not resolved for h2'); }
    // RLS: cross-tenant + author visibility
    (data(await users.h2a.client.from('price_items').select('id').eq('id', PI.native)).length === 0) ? ok('hotel_admin cannot read other-hotel price') : bad('cross-hotel price leaked');
    (data(await users.ro.client.from('price_items').select('id').eq('id', PI.draft)).length === 0) ? ok('read_only cannot see draft prices') : bad('read_only saw draft price');
    (data(await users.ed.client.from('price_items').select('id').eq('id', PI.draft)).length === 1) ? ok('editor (author) sees own-hotel draft prices') : bad('editor cannot see draft price');
    (data(await users.ed.client.from('price_items').select('id').eq('id', PI.plat)).length === 1) ? ok('member reads published platform-default price') : bad('platform price not visible to member');
    // write authority + column protection
    const updPI = async (c, patch, id) => (await c.from('price_items').update(patch).eq('id', id)).error?.message || null;
    await updPI(users.ro.client, { amount: 1 }, PI.native);
    (Number((await svc.from('price_items').select('amount').eq('id', PI.native).single()).data.amount) === 20) ? ok('read_only cannot write prices') : bad('read_only wrote price');
    { await updPI(users.ed.client, { amount: 22, hotel_id: HT.h2, key: `${P}-hacked`, override_of_price_item_id: PI.plat }, PI.native);
      const r = await svc.from('price_items').select('amount,hotel_id,key,override_of_price_item_id').eq('id', PI.native).single();
      (Number(r.data.amount) === 22 && r.data.hotel_id === HT.h1 && r.data.key === `${P}-late` && r.data.override_of_price_item_id === null) ? ok('editor edits price amount but not tenancy/link/key (trigger-protected)') : bad(`price protection wrong: ${JSON.stringify(r.data)}`); }
    { const e = await updPI(users.ed.client, { status: 'published' }, PI.draft);
      ((await svc.from('price_items').select('status').eq('id', PI.draft).single()).data.status === 'draft' && e && /direct publish/i.test(e)) ? ok('direct price publish blocked (use RPC)') : bad('direct price publish not blocked'); }
    // publish price via RPC + version
    { const r = await users.ed.client.rpc('publish_price_item', { p_item: PI.draft, p_change_summary: 'v1' });
      const s = (await svc.from('price_items').select('status,published_at').eq('id', PI.draft).single()).data;
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='price_item' and entity_id=$1`, [PI.draft])).rows[0].c;
      (!r.error && s.status === 'published' && s.published_at && v === 1) ? ok('editor publish_price_item -> published + immutable version') : bad(`price publish wrong: ${JSON.stringify(s)} v=${v} err=${r.error?.message}`); }
    { const r = await users.h2a.client.rpc('publish_price_item', { p_item: PI.native });
      (r.error && /privilege/i.test(r.error.message)) ? ok('other-hotel admin cannot publish this hotel price') : bad('cross-hotel price publish allowed'); }

    // ── I) audit ───────────────────────────────────────────────────────────────
    { const a = new Set((await q(`select action from public.audit_log where entity_type='destination_poi' and entity_id=$1`, [POI.draftPub])).rows.map(x => x.action));
      (a.has('create') && a.has('publish')) ? ok('canonical create+publish audited') : bad(`canonical audit missing: ${[...a]}`); }
    { const a = new Set((await q(`select action from public.audit_log where entity_type='price_item' and entity_id=$1`, [PI.draft])).rows.map(x => x.action));
      (a.has('publish')) ? ok('price publish audited') : bad(`price audit missing: ${[...a]}`); }
    { const c = (await q(`select count(*)::int c from public.audit_log where entity_type='hotel_poi_settings' and hotel_id=$1`, [HT.h1])).rows[0].c;
      (c >= 1) ? ok('presentation settings changes audited') : bad('presentation not audited'); }
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

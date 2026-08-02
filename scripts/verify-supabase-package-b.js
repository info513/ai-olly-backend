// ============================================================================
// AI OLLY Platform 2.0 — Package B verification (Steps 8/9/10, DEV ONLY)
// ----------------------------------------------------------------------------
// AI Knowledge, Guests/Stays/Consent, Reception Operations. Objects, RLS, tenant
// isolation, resolution order, publishing/versioning, critical ack, PII/secret
// protection, immutable consents, append-only request history, audit redaction.
// Real Auth test users; cleaned up. No secrets logged; no production writes.
// Run: npm run verify:supabase:packageb
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = 'Verify-PkgB-Pass!1';
const P = 'vsb', DOM = '@verify.local';
const BODY = (t) => ({ version: 1, blocks: [{ type: 'paragraph', text: t }] });
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const denied = (r) => !!(r && r.error);
const data = (r) => (r && r.data) ? r.data : [];
const ids = [];

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) { console.error('  Missing env'); process.exit(1); }
  console.log('AI OLLY — Package B (Steps 8/9/10) verification (aiolly-dev)\n');
  const svc = getSupabaseServerClient();
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, D = {}, HT = {}, RT = {}, RM = {}, A = {}, G = {}, ST = {}, CT = {}, CO = {}, GR = {};

  const cleanup = async () => {
    try { const { data: uu } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (uu?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    if (ids.length) { await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {}); }
    await q(`delete from public.audit_log where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    if (ids.length) await q(`delete from public.audit_log where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    await q(`delete from public.knowledge_articles where key like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.knowledge_categories where key like $1`, [P + '%']).catch(() => {});
    await q(`delete from public.consent_templates where key like $1`, [P + '%']).catch(() => {});
    // explicit dependency order (rooms.room_type_id is ON DELETE RESTRICT — cannot rely on hotel cascade)
    const hsub = `(select id from public.hotels where slug like $1)`;
    await q(`delete from public.stays where hotel_id in ${hsub}`, [P + '%']).catch(() => {});
    await q(`delete from public.rooms where hotel_id in ${hsub}`, [P + '%']).catch(() => {});
    await q(`delete from public.room_types where hotel_id in ${hsub}`, [P + '%']).catch(() => {});
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
    u[k] = { id: d.user.id, client: c };
  };
  const ins = async (table, row) => { const r = await svc.from(table).insert(row).select('id').single(); if (r.error) throw new Error(`ins ${table}: ${r.error.message}`); ids.push(r.data.id); return r.data.id; };
  const now = () => new Date().toISOString();
  const past = (d) => new Date(Date.now() - d * 864e5).toISOString();

  try {
    await cleanup();

    // ── A) catalog + RLS + anon-deny + no over-grant ────────────────────────────
    const TABLES = ['knowledge_categories', 'knowledge_articles', 'knowledge_article_sources', 'knowledge_aliases',
      'ai_configs', 'ai_response_logs', 'unanswered_questions', 'knowledge_embeddings',
      'guests', 'guest_duplicate_suggestions', 'stays', 'consent_templates', 'consents',
      'guest_requests', 'request_events', 'feedback', 'push_subscriptions'];
    for (const t of TABLES) {
      (await q(`select to_regclass('public.'||$1) ex`, [t])).rows[0].ex ? ok(`table ${t}`) : bad(`table ${t} missing`);
      (await q(`select relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0]?.r ? ok(`RLS on ${t}`) : bad(`RLS OFF ${t}`);
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c === 0 ? ok(`${t}: anon no grants`) : bad(`${t}: anon grants leaked`);
    }
    // append-only tables: service_role must NOT have DELETE
    for (const t of ['ai_response_logs', 'request_events']) {
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='service_role' and privilege_type='DELETE'`, [t])).rows[0].c === 0 ? ok(`${t}: service_role has no DELETE (append-only)`) : bad(`${t}: service_role DELETE leaked`);
    }
    // stays.access_token_hash + push secrets NOT selectable by authenticated
    (await q(`select count(*)::int c from information_schema.column_privileges where table_schema='public' and table_name='stays' and column_name='access_token_hash' and privilege_type='SELECT' and grantee in ('authenticated','anon')`)).rows[0].c === 0 ? ok('stays.access_token_hash not SELECTable by anon/authenticated') : bad('stay token column leaked');
    (await q(`select count(*)::int c from information_schema.column_privileges where table_schema='public' and table_name='push_subscriptions' and column_name in ('endpoint','p256dh','auth_key') and privilege_type='SELECT' and grantee in ('authenticated','anon')`)).rows[0].c === 0 ? ok('push endpoint/keys not SELECTable by anon/authenticated') : bad('push secrets column leaked');
    for (const fn of ['publish_knowledge_article', 'rollback_knowledge_article', 'resolved_ai_knowledge', 'resolved_ai_config', 'pseudonymize_guest', 'resolved_active_stay', 'resolved_stays', 'sign_consent', 'revoke_consent', 'publish_consent_template'])
      (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rowCount ? ok(`function public.${fn}`) : bad(`function ${fn} missing`);
    (await q(`select 1 from information_schema.views where table_schema='public' and table_name='guest_request_public'`)).rowCount ? ok('view guest_request_public') : bad('safe guest view missing');
    (await q(`select count(*)::int c from information_schema.columns where table_schema='public' and table_name='guest_request_public' and column_name='internal_notes'`)).rows[0].c === 0 ? ok('safe guest view excludes internal_notes') : bad('internal_notes leaked into safe view');

    // ── B) fixtures ────────────────────────────────────────────────────────────
    D.a = await ins('destinations', { name: 'DA', slug: `${P}-da`, timezone: 'Europe/Zagreb' });
    HT.h1 = await ins('hotels', { name: 'H1', slug: `${P}-h1`, destination_id: D.a, timezone: 'Europe/Zagreb', currency: 'EUR' });
    HT.h2 = await ins('hotels', { name: 'H2', slug: `${P}-h2`, destination_id: D.a, timezone: 'Europe/Zagreb', currency: 'EUR' });
    RT.h1 = await ins('room_types', { hotel_id: HT.h1, name: 'RT', slug: `${P}-rt` });
    RT.h2 = await ins('room_types', { hotel_id: HT.h2, name: 'RT2', slug: `${P}-rt2` });
    RM.h1 = await ins('rooms', { hotel_id: HT.h1, room_type_id: RT.h1, room_number: '101', access_token: `${P}-tok-1` });
    RM.h2 = await ins('rooms', { hotel_id: HT.h2, room_type_id: RT.h2, room_number: '201', access_token: `${P}-tok-2` });
    // knowledge
    const kcat = await ins('knowledge_categories', { hotel_id: null, key: `${P}-cat`, name: 'Cat' });
    A.plat = await ins('knowledge_articles', { hotel_id: null, destination_id: null, category_id: kcat, key: `${P}-checkin`, title: 'Check-in', body_content: BODY('PLATFORM checkin'), locale: 'en', status: 'published', available_to_ai: true, published_at: now() });
    A.dest = await ins('knowledge_articles', { hotel_id: null, destination_id: D.a, key: `${P}-local`, title: 'Local', body_content: BODY('DEST local'), locale: 'en', status: 'published', available_to_ai: true, published_at: now() });
    A.hwifi = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-wifi`, title: 'Wifi', body_content: BODY('HOTEL wifi'), locale: 'en', status: 'published', available_to_ai: true, published_at: now() });
    A.hover = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-checkin`, title: 'Check-in H1', body_content: BODY('OVERRIDE checkin'), locale: 'en', status: 'published', available_to_ai: true, override_of_article_id: A.plat, published_at: now() });
    A.exp = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-expired`, title: 'Expired', body_content: BODY('expired'), locale: 'en', status: 'published', available_to_ai: true, valid_to: past(1), published_at: past(2) });
    A.draft = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-draft`, title: 'Draft', body_content: BODY('draft'), locale: 'en', status: 'draft' });
    A.crit = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-emerg`, title: 'Emergency', body_content: BODY('critical'), locale: 'en', status: 'draft', is_critical: true });
    A.pub = await ins('knowledge_articles', { hotel_id: HT.h1, key: `${P}-pub`, title: 'PubV1', body_content: BODY('v1'), locale: 'en', status: 'draft' });
    A.h2 = await ins('knowledge_articles', { hotel_id: HT.h2, key: `${P}-h2kb`, title: 'H2', body_content: BODY('h2'), locale: 'en', status: 'published', available_to_ai: true, published_at: now() });
    await ins('knowledge_aliases', { hotel_id: HT.h1, article_id: A.hwifi, locale: 'en', alias_text: '  WiFi Password  ' });
    // guests / stays / consent
    G.g1 = await ins('guests', { hotel_id: HT.h1, first_name: 'Ana', last_name: 'Anic', email: `${P}.pii${DOM}`, phone: '+385000', preferred_locale: 'en' });
    G.g1b = await ins('guests', { hotel_id: HT.h1, first_name: 'Ana', last_name: 'Anic', email: `${P}.pii2${DOM}` });
    G.g2 = await ins('guests', { hotel_id: HT.h2, first_name: 'Bob', last_name: 'Bobic' });
    ST.s1 = await ins('stays', { hotel_id: HT.h1, guest_id: G.g1, room_id: RM.h1, status: 'checked_in', arrival_at: now(), checked_in_at: now(), access_token_hash: 'sha256$SYNTH' });
    CT.t1 = await ins('consent_templates', { hotel_id: HT.h1, key: `${P}-mkt`, locale: 'en', version: 1, title: 'Marketing', body_text: '[SYNTHETIC CONSENT TEXT v1]', status: 'published', published_at: now() });
    CT.draft = await ins('consent_templates', { hotel_id: HT.h1, key: `${P}-draftt`, locale: 'en', version: 1, title: 'DraftT', body_text: '[DRAFT]', status: 'draft' });
    ok('service_role created synthetic Package B fixtures');

    // ── C) users + memberships ─────────────────────────────────────────────────
    await mkUser('pa', true); await mkUser('h1a'); await mkUser('h1r'); await mkUser('h1e'); await mkUser('h1ro'); await mkUser('h1m'); await mkUser('h2a'); await mkUser('nm'); await mkUser('su');
    await svc.from('hotel_memberships').insert([
      { hotel_id: HT.h1, user_id: u.h1a.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1r.id, role: 'reception', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1e.id, role: 'editor', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1ro.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1m.id, role: 'marketing', status: 'active' },
      { hotel_id: HT.h2, user_id: u.h2a.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: u.su.id, role: 'read_only', status: 'suspended' },
    ]);

    // ══ STEP 8 — AI KNOWLEDGE ══════════════════════════════════════════════════
    // resolution order + dedup + drafts-excluded + override-wins + validity
    const live = data({ data: (await svc.rpc('resolved_ai_knowledge', { p_hotel: HT.h1, p_locale: 'en' })).data });
    const byKey = Object.fromEntries(live.map(x => [x.key, x]));
    (byKey[`${P}-checkin`] && byKey[`${P}-checkin`].source === 'override' && byKey[`${P}-checkin`].title === 'Check-in H1') ? ok('resolution: hotel override wins over platform') : bad(`override resolution wrong: ${JSON.stringify(byKey[`${P}-checkin`])}`);
    (byKey[`${P}-local`] && byKey[`${P}-local`].source === 'destination') ? ok('resolution: destination knowledge resolves') : bad('destination resolution wrong');
    (byKey[`${P}-wifi`] && byKey[`${P}-wifi`].source === 'hotel') ? ok('resolution: hotel knowledge resolves') : bad('hotel resolution wrong');
    (live.filter(x => x.key === `${P}-checkin`).length === 1) ? ok('no duplicate resolved knowledge (override dedup)') : bad('duplicate resolved article');
    (!byKey[`${P}-draft`] && !byKey[`${P}-emerg`]) ? ok('drafts excluded from live AI retrieval') : bad('draft leaked into live');
    (!byKey[`${P}-expired`]) ? ok('expired knowledge excluded (validity respected)') : bad('expired knowledge served');
    // preview visible only to authorized author
    { const ed = (await u.h1e.client.rpc('resolved_ai_knowledge', { p_hotel: HT.h1, p_locale: 'en', p_preview: true })).data || [];
      const ro = (await u.h1ro.client.rpc('resolved_ai_knowledge', { p_hotel: HT.h1, p_locale: 'en', p_preview: true })).data || [];
      (ed.some(x => x.key === `${P}-draft`)) ? ok('preview mode: author (editor) sees draft knowledge') : bad('editor cannot preview draft');
      (!ro.some(x => x.key === `${P}-draft`)) ? ok('preview mode: non-author (read_only) sees no drafts') : bad('read_only previewed drafts'); }
    // RLS write scope: platform article only platform_admin; hotel article by editor
    await u.h1e.client.from('knowledge_articles').update({ title: 'HACK' }).eq('id', A.plat);
    ((await svc.from('knowledge_articles').select('title').eq('id', A.plat).single()).data.title === 'Check-in') ? ok('hotel users cannot edit platform knowledge') : bad('platform knowledge edited by hotel user');
    { await u.h1e.client.from('knowledge_articles').update({ title: 'ED WIFI', hotel_id: HT.h2, key: `${P}-hack` }).eq('id', A.hwifi);
      const r = await svc.from('knowledge_articles').select('title,hotel_id,key').eq('id', A.hwifi).single();
      (r.data.title === 'ED WIFI' && r.data.hotel_id === HT.h1 && r.data.key === `${P}-wifi`) ? ok('editor edits hotel knowledge but not tenancy/key (trigger-protected)') : bad(`knowledge protection wrong: ${JSON.stringify(r.data)}`); }
    // direct publish blocked
    { const e = (await u.h1e.client.from('knowledge_articles').update({ status: 'published' }).eq('id', A.pub)).error?.message;
      ((await svc.from('knowledge_articles').select('status').eq('id', A.pub).single()).data.status === 'draft' && e && /direct publish/i.test(e)) ? ok('direct knowledge publish blocked (use RPC)') : bad('direct knowledge publish not blocked'); }
    // publish + version
    { const r = await u.h1e.client.rpc('publish_knowledge_article', { p_article: A.pub, p_change_summary: 'v1' });
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='knowledge_article' and entity_id=$1`, [A.pub])).rows[0].c;
      (!r.error && (await svc.from('knowledge_articles').select('status').eq('id', A.pub).single()).data.status === 'published' && v === 1) ? ok('editor publish_knowledge_article -> published + immutable version') : bad(`knowledge publish wrong: v=${v} err=${r.error?.message}`); }
    // critical acknowledgement
    { const r = await u.h1a.client.rpc('publish_knowledge_article', { p_article: A.crit });
      (r.error && /critical/i.test(r.error.message)) ? ok('critical knowledge publish without ack rejected') : bad('critical published without ack');
      const r2 = await u.h1a.client.rpc('publish_knowledge_article', { p_article: A.crit, p_acknowledge_critical: true });
      (!r2.error && (await svc.from('knowledge_articles').select('status').eq('id', A.crit).single()).data.status === 'published') ? ok('critical knowledge publish with ack succeeds') : bad(`critical ack publish failed: ${r2.error?.message}`); }
    // rollback safe
    { await svc.from('knowledge_articles').update({ title: 'PubV2', status: 'draft' }).eq('id', A.pub);
      await u.h1e.client.rpc('publish_knowledge_article', { p_article: A.pub, p_change_summary: 'v2' });
      const v1 = (await q(`select id from public.content_versions where entity_type='knowledge_article' and entity_id=$1 and version_number=1`, [A.pub])).rows[0].id;
      const r = await u.h1e.client.rpc('rollback_knowledge_article', { p_article: A.pub, p_version: v1 });
      const s = await svc.from('knowledge_articles').select('title,status').eq('id', A.pub).single();
      (!r.error && s.data.title === 'PubV1' && s.data.status === 'draft') ? ok('rollback restores prior snapshot as draft (history intact)') : bad(`rollback wrong: ${JSON.stringify(s.data)} err=${r.error?.message}`);
      ((await q(`select count(*)::int c from public.content_versions where entity_type='knowledge_article' and entity_id=$1`, [A.pub])).rows[0].c === 2) ? ok('rollback did not mutate historical versions') : bad('history altered'); }
    // aliases normalized + scoped uniqueness
    ((await svc.from('knowledge_aliases').select('normalized_alias').eq('article_id', A.hwifi).single()).data.normalized_alias === 'wifi password') ? ok('alias normalized (lowercase/trim)') : bad('alias not normalized');
    denied(await svc.from('knowledge_aliases').insert({ hotel_id: HT.h1, article_id: A.hwifi, locale: 'en', alias_text: 'WIFI PASSWORD' })) ? ok('alias unique per (hotel,locale,normalized)') : bad('duplicate alias allowed');
    denied(await svc.from('knowledge_aliases').insert({ hotel_id: HT.h1, article_id: A.hwifi, locale: 'en', alias_text: 'a' })) ? ok('alias rejects too-broad short term') : bad('unsafe short alias allowed');
    // AI logs protected + tenant-scoped
    { const lid = await ins('ai_response_logs', { hotel_id: HT.h1, room_id: RM.h1, question: 'q', answer: 'a', route_type: 'knowledge', handoff: false });
      (data(await anon.from('ai_response_logs').select('id')).length === 0) ? ok('anon cannot read ai_response_logs') : bad('anon read logs');
      (data(await u.h1e.client.from('ai_response_logs').select('id')).length === 0) ? ok('editor cannot read ai_response_logs (guest-context protected)') : bad('editor read logs');
      (data(await u.h1a.client.from('ai_response_logs').select('id').eq('id', lid)).length === 1) ? ok('hotel_admin reads own-hotel ai_response_logs') : bad('hotel_admin cannot read own logs');
      (data(await u.h2a.client.from('ai_response_logs').select('id').eq('id', lid)).length === 0) ? ok('ai_response_logs tenant-isolated') : bad('cross-hotel log leak'); }
    // unanswered questions tenant-isolated
    { const uq = await ins('unanswered_questions', { hotel_id: HT.h1, normalized_question: 'where is the pool', original_question: 'Where is the pool?' });
      (data(await u.h1e.client.from('unanswered_questions').select('id').eq('id', uq)).length === 1) ? ok('hotel member reads own unanswered questions') : bad('member cannot read unanswered');
      (data(await u.h2a.client.from('unanswered_questions').select('id').eq('id', uq)).length === 0) ? ok('unanswered questions tenant-isolated') : bad('cross-hotel unanswered leak'); }

    // ══ STEP 9 — GUESTS / STAYS / CONSENT ══════════════════════════════════════
    (data(await anon.from('guests').select('id')).length === 0) ? ok('anon cannot read guests') : bad('anon read guests');
    (data(await u.nm.client.from('guests').select('id')).length === 0) ? ok('no-membership cannot read guests') : bad('no-membership read guests');
    (data(await u.su.client.from('guests').select('id')).length === 0) ? ok('suspended cannot read guests') : bad('suspended read guests');
    (data(await u.h1r.client.from('guests').select('id').eq('id', G.g1)).length === 1) ? ok('reception reads own-hotel guests (PII)') : bad('reception cannot read guests');
    (data(await u.h1a.client.from('guests').select('id').eq('id', G.g1)).length === 1) ? ok('hotel_admin reads own-hotel guests') : bad('hotel_admin cannot read guests');
    (data(await u.h2a.client.from('guests').select('id').eq('id', G.g1)).length === 0) ? ok('guests hotel-isolated (other-hotel admin blocked)') : bad('cross-hotel guest leak');
    (data(await u.h1e.client.from('guests').select('id')).length === 0) ? ok('editor cannot see guest PII') : bad('editor saw guests');
    (data(await u.h1m.client.from('guests').select('id')).length === 0) ? ok('marketing cannot see guest PII') : bad('marketing saw guests');
    (data(await u.h1ro.client.from('guests').select('id')).length === 0) ? ok('read_only cannot see guest PII') : bad('read_only saw guests');
    // cross-hotel stay links rejected
    denied(await svc.from('stays').insert({ hotel_id: HT.h1, guest_id: G.g1, room_id: RM.h2, status: 'reserved' })) ? ok('stay rejects room from another hotel') : bad('cross-hotel room stay allowed');
    denied(await svc.from('stays').insert({ hotel_id: HT.h1, guest_id: G.g2, room_id: RM.h1, status: 'reserved' })) ? ok('stay rejects guest from another hotel') : bad('cross-hotel guest stay allowed');
    // manual stay works + reception can create
    { const r = await u.h1r.client.from('stays').insert({ hotel_id: HT.h1, guest_id: G.g1b, room_id: RM.h1, status: 'reserved', arrival_at: now() }); !denied(r) ? ok('reception creates a manual stay') : bad(`manual stay failed: ${r.error?.message}`);
      if (r.data) ids.push(r.data[0]?.id); }
    // tokens hidden from safe views/functions
    denied(await u.h1a.client.from('stays').select('access_token_hash').limit(1)) ? ok('stay access_token_hash not selectable (column-protected)') : bad('stay token READ leaked');
    { const rs = (await u.h1e.client.rpc('resolved_stays', { p_hotel: HT.h1 })).data || [];
      (rs.length >= 1 && !('access_token_hash' in (rs[0] || {})) && !('email' in (rs[0] || {}))) ? ok('resolved_stays exposes no token/PII (first name only)') : bad(`resolved_stays leaked fields: ${JSON.stringify(Object.keys(rs[0] || {}))}`); }
    { const rss = (await u.h1ro.client.rpc('resolved_stays', { p_hotel: HT.h1 }));
      denied(rss) ? ok('read_only denied resolved_stays') : bad('read_only accessed resolved_stays'); }
    // active stay deterministic
    { const asr = (await svc.rpc('resolved_active_stay', { p_room: RM.h1 })).data || []; (asr.length === 1 && asr[0].stay_id === ST.s1) ? ok('resolved_active_stay returns the single checked-in stay') : bad('active stay resolution wrong'); }
    // duplicate suggestion, not auto-merge
    { const ds = await ins('guest_duplicate_suggestions', { hotel_id: HT.h1, guest_id: G.g1, candidate_guest_id: G.g1b, match_reason: 'same name', match_score: 0.8 });
      const both = (await q(`select count(*)::int c from public.guests where id in ($1,$2)`, [G.g1, G.g1b])).rows[0].c;
      (both === 2) ? ok('duplicate matching creates a suggestion, guests NOT auto-merged') : bad('guests auto-merged'); }
    // pseudonymization: only admin; protected column
    { const r = await u.h1e.client.rpc('pseudonymize_guest', { p_guest: G.g1b }); (r.error && /privilege/i.test(r.error.message)) ? ok('editor cannot pseudonymize guest') : bad('editor pseudonymized guest');
      await u.h1r.client.from('guests').update({ pseudonymized_at: now() }).eq('id', G.g1b);
      ((await svc.from('guests').select('pseudonymized_at').eq('id', G.g1b).single()).data.pseudonymized_at === null) ? ok('staff cannot set pseudonymized_at directly (protected)') : bad('pseudonymized_at set directly');
      const r2 = await u.h1a.client.rpc('pseudonymize_guest', { p_guest: G.g1b });
      const g = (await svc.from('guests').select('first_name,email,pseudonymized_at').eq('id', G.g1b).single()).data;
      (!r2.error && g.first_name === null && g.email === null && g.pseudonymized_at) ? ok('hotel_admin pseudonymize_guest strips PII + stamps') : bad(`pseudonymize wrong: ${JSON.stringify(g)}`); }
    // consent: published template required
    { const r = await u.h1r.client.rpc('sign_consent', { p_template: CT.draft, p_guest: G.g1, p_stay: ST.s1, p_signed_name: 'Ana Anic' });
      (r.error && /published/i.test(r.error.message)) ? ok('cannot sign consent from a draft template') : bad('signed from draft template'); }
    // sign consent from published template
    { const r = await u.h1r.client.rpc('sign_consent', { p_template: CT.t1, p_guest: G.g1, p_stay: ST.s1, p_signed_name: 'Ana Anic', p_device: { ua: 'test' } });
      CO.c1 = r.data?.id; if (CO.c1) ids.push(CO.c1);
      (!r.error && r.data?.consent_text_snapshot === '[SYNTHETIC CONSENT TEXT v1]' && r.data?.status === 'granted') ? ok('sign_consent snapshots exact published text') : bad(`sign_consent wrong: ${r.error?.message}`); }
    // signed snapshot immutable
    { await u.h1r.client.from('consents').update({ consent_text_snapshot: 'TAMPERED', signed_name: 'Hacker' }).eq('id', CO.c1);
      const c = (await svc.from('consents').select('consent_text_snapshot,signed_name').eq('id', CO.c1).single()).data;
      (c.consent_text_snapshot === '[SYNTHETIC CONSENT TEXT v1]' && c.signed_name === 'Ana Anic') ? ok('signed consent snapshot immutable') : bad('consent snapshot mutated'); }
    // template update does not alter signed snapshot
    { await svc.from('consent_templates').update({ body_text: '[SYNTHETIC CONSENT TEXT v2]' }).eq('id', CT.t1);
      ((await svc.from('consents').select('consent_text_snapshot').eq('id', CO.c1).single()).data.consent_text_snapshot === '[SYNTHETIC CONSENT TEXT v1]') ? ok('template edit does not change signed snapshot') : bad('signed snapshot followed template'); }
    // revocation preserves original
    { const r = await u.h1r.client.rpc('revoke_consent', { p_consent: CO.c1 });
      const c = (await svc.from('consents').select('status,revoked_at,consent_text_snapshot,signed_name').eq('id', CO.c1).single()).data;
      (!r.error && c.status === 'revoked' && c.revoked_at && c.consent_text_snapshot === '[SYNTHETIC CONSENT TEXT v1]' && c.signed_name === 'Ana Anic') ? ok('revocation is additive (original signed record preserved)') : bad(`revoke wrong: ${JSON.stringify(c)}`); }
    // consent cross-tenant + editor no access
    (data(await u.h2a.client.from('consents').select('id').eq('id', CO.c1)).length === 0) ? ok('consents cross-tenant isolated') : bad('cross-hotel consent leak');
    (data(await u.h1e.client.from('consents').select('id')).length === 0) ? ok('editor cannot read consents (private)') : bad('editor read consents');

    // ══ STEP 10 — RECEPTION ════════════════════════════════════════════════════
    // request lifecycle + append-only history
    { const r = await u.h1r.client.from('guest_requests').insert({ hotel_id: HT.h1, stay_id: ST.s1, room_id: RM.h1, request_type: 'housekeeping', title: 'Towels', description: 'Need towels', internal_notes: 'VIP' }).select('id').single();
      GR.r1 = r.data?.id; if (GR.r1) ids.push(GR.r1);
      !denied(r) ? ok('reception creates a guest request') : bad(`request create failed: ${r.error?.message}`);
      const e1 = (await u.h1r.client.from('guest_requests').update({ status: 'acknowledged' }).eq('id', GR.r1)).error?.message;
      const e2 = (await u.h1r.client.from('guest_requests').update({ status: 'resolved' }).eq('id', GR.r1)).error?.message;
      const ev = (await q(`select event_type from public.request_events where request_id=$1 order by created_at`, [GR.r1])).rows.map(x => x.event_type);
      (ev.includes('created') && ev.includes('acknowledged') && ev.includes('resolved')) ? ok('request lifecycle logged to append-only history') : bad(`request events wrong: ${ev} e1=${e1} e2=${e2}`); }
    // append-only request_events
    denied(await svc.from('request_events').update({ note: 'x' }).eq('request_id', GR.r1)) ? ok('request_events append-only (UPDATE blocked)') : bad('request_events mutable');
    // internal notes not in safe guest view (queried as reception — the authenticated audience)
    { const v = (await u.h1r.client.from('guest_request_public').select('*').eq('id', GR.r1).single()).data;
      (v && !('internal_notes' in v)) ? ok('safe guest view omits internal_notes') : bad('internal_notes exposed in safe view'); }
    // reception manages own hotel; cannot access another; editor/marketing/read_only denied write
    (data(await u.h2a.client.from('guest_requests').select('id').eq('id', GR.r1)).length === 0) ? ok('reception request not visible to another hotel') : bad('cross-hotel request leak');
    denied(await u.h1e.client.from('guest_requests').insert({ hotel_id: HT.h1, request_type: 'x', title: 'y' })) ? ok('editor denied operational request write') : bad('editor wrote request');
    denied(await u.h1m.client.from('guest_requests').insert({ hotel_id: HT.h1, request_type: 'x', title: 'y' })) ? ok('marketing denied operational request write') : bad('marketing wrote request');
    denied(await u.h1ro.client.from('guest_requests').insert({ hotel_id: HT.h1, request_type: 'x', title: 'y' })) ? ok('read_only denied operational request write') : bad('read_only wrote request');
    // feedback isolated
    { const f = await ins('feedback', { hotel_id: HT.h1, stay_id: ST.s1, rating: 5, message: 'Great', status: 'new' });
      (data(await u.h1r.client.from('feedback').select('id').eq('id', f)).length === 1) ? ok('reception reads own-hotel feedback') : bad('reception cannot read feedback');
      (data(await u.h2a.client.from('feedback').select('id').eq('id', f)).length === 0) ? ok('feedback tenant-isolated') : bad('cross-hotel feedback leak'); }
    // push secrets hidden + revocation
    { const ps = await ins('push_subscriptions', { hotel_id: HT.h1, user_id: u.h1a.id, endpoint: 'https://fcm.invalid/SECRET', p256dh: 'SECRETKEY', auth_key: 'SECRETAUTH', active: true });
      denied(await u.h1a.client.from('push_subscriptions').select('endpoint').eq('id', ps)) ? ok('push endpoint not selectable by authenticated') : bad('push endpoint READ leaked');
      (data(await u.h1a.client.from('push_subscriptions').select('id,active').eq('id', ps)).length === 1) ? ok('push metadata readable (no secrets)') : bad('push metadata read failed');
      await u.h1a.client.from('push_subscriptions').update({ active: false, revoked_at: now() }).eq('id', ps);
      ((await svc.from('push_subscriptions').select('active,revoked_at').eq('id', ps).single()).data.active === false) ? ok('push subscription revocation works') : bad('push revoke failed'); }

    // ══ GLOBAL — audit contains no protected secrets ═══════════════════════════
    { const rows = (await q(`select coalesce(before_state::text,'')||coalesce(after_state::text,'')||coalesce(metadata::text,'') s from public.audit_log where hotel_id=$1`, [HT.h1])).rows.map(r => r.s).join('||');
      const leaks = ['pii@verify.local', `${P}.pii${DOM}`, '+385000', 'sha256$SYNTH', 'SECRETKEY', 'SECRETAUTH', 'https://fcm.invalid/SECRET', 'SYNTHETIC CONSENT TEXT', 'Ana Anic'];
      const found = leaks.filter(x => rows.includes(x));
      (found.length === 0) ? ok('audit snapshots contain NO PII/tokens/secrets/consent-text') : bad(`audit leaked secrets: ${found.join(', ')}`); }
    { const acts = new Set((await q(`select action from public.audit_log where entity_type='guest' and hotel_id=$1`, [HT.h1])).rows.map(r => r.action));
      (acts.has('create')) ? ok('guest lifecycle audited (redacted)') : bad('guest not audited'); }
    { const c = (await q(`select count(*)::int c from public.audit_log where entity_type='consent' and hotel_id=$1`, [HT.h1])).rows[0].c;
      (c >= 1) ? ok('consent create/revoke audited (redacted)') : bad('consent not audited'); }
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

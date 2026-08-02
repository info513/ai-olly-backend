// ============================================================================
// AI OLLY Platform 2.0 — Package C verification (Steps 11/12/13, DEV ONLY)
// ----------------------------------------------------------------------------
// Storage & Asset Manager, Newsletter, Analytics Foundation. Objects, buckets,
// Storage RLS, asset/usage rules, tenant isolation, newsletter consent/segment/
// campaign immutability, idempotent webhooks, analytics aggregates + role access,
// audit redaction. Real Auth users + synthetic Storage objects; cleaned up. No
// real emails. No secrets logged. Run: npm run verify:supabase:packagec
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = 'Verify-PkgC-Pass!1';
const P = 'vspc', DOM = '@verify.local';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const denied = (r) => !!(r && r.error);
const data = (r) => (r && r.data) ? r.data : [];
const ids = [], spaths = [];   // db ids + uploaded storage paths (bucket:name)

async function main() {
  if (!URL || !ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) { console.error('  Missing env'); process.exit(1); }
  console.log('AI OLLY — Package C (Steps 11/12/13) verification (aiolly-dev)\n');
  const svc = getSupabaseServerClient();
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, D = {}, HT = {}, RT = {}, RM = {}, AS = {}, G = {}, CT = {}, CO = {}, SUB = {}, SEG = {}, TPL = {}, CMP = {};

  const cleanup = async () => {
    try { const { data: uu } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (uu?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    for (const sp of spaths) { const [b, ...rest] = sp.split(':'); await svc.storage.from(b).remove([rest.join(':')]).catch(() => {}); }
    if (ids.length) { await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {}); await q(`delete from public.audit_log where entity_id = any($1::uuid[])`, [ids]).catch(() => {}); }
    await q(`delete from public.audit_log where hotel_id in (select id from public.hotels where slug like $1)`, [P + '%']).catch(() => {});
    const hsub = `(select id from public.hotels where slug like $1)`;
    for (const t of ['ai_quality_daily', 'operations_daily', 'newsletter_daily', 'content_health_daily',
      'newsletter_events', 'newsletter_campaign_recipients', 'newsletter_campaigns', 'newsletter_segment_members',
      'newsletter_segments', 'newsletter_templates', 'newsletter_subscribers', 'newsletter_webhook_events',
      'asset_usages', 'assets', 'consents', 'consent_templates', 'guests', 'stays', 'rooms', 'room_types'])
      await q(`delete from public.${t} where hotel_id in ${hsub}`, [P + '%']).catch(() => {});
    await q(`delete from public.assets where destination_id in (select id from public.destinations where slug like $1)`, [P + '%']).catch(() => {});
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
  const blob = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });

  try {
    await cleanup();

    // ── A) catalog / buckets / policies / RLS / no-over-grant ───────────────────
    const TABLES = ['assets', 'asset_usages', 'newsletter_subscribers', 'newsletter_segments', 'newsletter_segment_members',
      'newsletter_templates', 'newsletter_campaigns', 'newsletter_campaign_recipients', 'newsletter_events',
      'newsletter_webhook_events', 'ai_quality_daily', 'operations_daily', 'newsletter_daily', 'content_health_daily'];
    for (const t of TABLES) {
      (await q(`select to_regclass('public.'||$1) ex`, [t])).rows[0].ex ? ok(`table ${t}`) : bad(`table ${t} missing`);
      (await q(`select relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0]?.r ? ok(`RLS on ${t}`) : bad(`RLS OFF ${t}`);
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c === 0 ? ok(`${t}: anon no grants`) : bad(`${t}: anon grants leaked`);
    }
    for (const b of ['public-media', 'private-documents', 'consent-files'])
      (await q(`select public from storage.buckets where id=$1`, [b])).rowCount ? ok(`bucket ${b} exists (public=${(await q(`select public from storage.buckets where id=$1`, [b])).rows[0].public})`) : bad(`bucket ${b} missing`);
    ((await q(`select public from storage.buckets where id='public-media'`)).rows[0].public === true) ? ok('public-media is public') : bad('public-media not public');
    ((await q(`select public from storage.buckets where id='consent-files'`)).rows[0].public === false) ? ok('consent-files is private') : bad('consent-files not private');
    ((await q(`select count(*)::int c from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'pkgc_%'`)).rows[0].c >= 4) ? ok('storage.objects public-media policies present') : bad('storage policies missing');
    for (const t of ['newsletter_events', 'newsletter_webhook_events'])
      (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='service_role' and privilege_type='DELETE'`, [t])).rows[0].c === 0 ? ok(`${t}: service_role no DELETE (append-only)`) : bad(`${t}: DELETE leaked`);
    (await q(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='newsletter_webhook_events' and grantee='authenticated'`)).rows[0].c === 0 ? ok('webhook_events: no authenticated grants (backend-only)') : bad('webhook_events authenticated leak');
    for (const fn of ['finalize_asset', 'asset_usage_report', 'publish_newsletter_template', 'schedule_campaign', 'resolve_newsletter_audience', 'refresh_analytics', 'refresh_ai_quality_daily'])
      (await q(`select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rowCount ? ok(`function public.${fn}`) : bad(`function ${fn} missing`);

    // ── B) fixtures ────────────────────────────────────────────────────────────
    D.a = await ins('destinations', { name: 'DA', slug: `${P}-da`, timezone: 'Europe/Zagreb' });
    HT.h1 = await ins('hotels', { name: 'H1', slug: `${P}-h1`, destination_id: D.a, timezone: 'Europe/Zagreb', currency: 'EUR' });
    HT.h2 = await ins('hotels', { name: 'H2', slug: `${P}-h2`, destination_id: D.a, timezone: 'Europe/Zagreb', currency: 'EUR' });
    RT.h1 = await ins('room_types', { hotel_id: HT.h1, name: 'RT', slug: `${P}-rt` });
    RM.h1 = await ins('rooms', { hotel_id: HT.h1, room_type_id: RT.h1, room_number: '101', access_token: `${P}-tok` });
    await mkUser('pa', true); await mkUser('h1a'); await mkUser('h1e'); await mkUser('h1m'); await mkUser('h1r'); await mkUser('h1ro'); await mkUser('h2a'); await mkUser('nm');
    await svc.from('hotel_memberships').insert([
      { hotel_id: HT.h1, user_id: u.h1a.id, role: 'hotel_admin', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1e.id, role: 'editor', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1m.id, role: 'marketing', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1r.id, role: 'reception', status: 'active' },
      { hotel_id: HT.h1, user_id: u.h1ro.id, role: 'read_only', status: 'active' },
      { hotel_id: HT.h2, user_id: u.h2a.id, role: 'hotel_admin', status: 'active' },
    ]);

    // ══ STEP 11 — STORAGE / ASSETS ═════════════════════════════════════════════
    // asset ownership derivation + constraints
    AS.logo = await ins('assets', { hotel_id: HT.h1, bucket_name: 'public-media', storage_path: `hotels/${HT.h1}/logo.png`, asset_type: 'logo', mime_type: 'image/png', file_size_bytes: 5000, status: 'ready', alt_text: 'logo', rights_owner: 'H1' });
    AS.destimg = await ins('assets', { destination_id: D.a, bucket_name: 'public-media', storage_path: `destinations/${D.a}/poi.jpg`, asset_type: 'poi_image', mime_type: 'image/jpeg', file_size_bytes: 8000, status: 'ready' });
    AS.sig = await ins('assets', { hotel_id: HT.h1, bucket_name: 'consent-files', storage_path: `hotels/${HT.h1}/consents/x/sig.png`, asset_type: 'consent_signature', mime_type: 'image/png', file_size_bytes: 2000, status: 'ready' });
    ((await svc.from('assets').select('owner_scope').eq('id', AS.logo).single()).data.owner_scope === 'hotel') ? ok('asset owner_scope derived (hotel)') : bad('hotel scope wrong');
    ((await svc.from('assets').select('owner_scope').eq('id', AS.destimg).single()).data.owner_scope === 'destination') ? ok('asset owner_scope derived (destination)') : bad('destination scope wrong');
    denied(await svc.from('assets').insert({ hotel_id: HT.h1, bucket_name: 'public-media', storage_path: 'x', asset_type: 'room_image', file_size_bytes: 999999999 })) ? ok('asset size limit enforced (15MB image)') : bad('oversized image allowed');
    denied(await svc.from('assets').insert({ hotel_id: HT.h1, bucket_name: 'public-media', storage_path: 'x', asset_type: 'consent_signature', file_size_bytes: 1000 })) ? ok('private asset type rejected from public-media bucket') : bad('private type in public bucket allowed');
    // finalize
    { const r = await u.h1a.client.rpc('finalize_asset', { p_asset: AS.logo, p_size: 6000 }); (!r.error && r.data?.status === 'ready') ? ok('finalize_asset -> ready (hotel_admin)') : bad(`finalize failed: ${r.error?.message}`); }
    // RLS: private consent asset visible only to hotel_admin/reception, not editor/marketing/read_only
    (data(await u.h1r.client.from('assets').select('id').eq('id', AS.sig)).length === 1) ? ok('reception can read private consent asset') : bad('reception cannot read consent asset');
    (data(await u.h1e.client.from('assets').select('id').eq('id', AS.sig)).length === 0) ? ok('editor cannot read private consent asset') : bad('editor read consent asset');
    (data(await u.h1m.client.from('assets').select('id').eq('id', AS.sig)).length === 0) ? ok('marketing cannot read private consent asset') : bad('marketing read consent asset');
    (data(await u.h1ro.client.from('assets').select('id').eq('id', AS.sig)).length === 0) ? ok('read_only cannot read private consent asset') : bad('read_only read consent asset');
    // public asset visible to members; tenant isolation
    (data(await u.h1e.client.from('assets').select('id').eq('id', AS.logo)).length === 1) ? ok('editor reads public hotel asset') : bad('editor cannot read public asset');
    (data(await u.h2a.client.from('assets').select('id').eq('id', AS.logo)).length === 0) ? ok('assets tenant-isolated (other-hotel admin blocked)') : bad('cross-hotel asset leak');
    (data(await u.h1e.client.from('assets').select('id').eq('id', AS.destimg)).length === 1) ? ok('destination asset readable by accessing member') : bad('destination asset not readable');
    // role write rules
    denied(await u.h1ro.client.from('assets').insert({ hotel_id: HT.h1, bucket_name: 'public-media', storage_path: 'y', asset_type: 'hotel_image', file_size_bytes: 1000 })) ? ok('read_only cannot create assets') : bad('read_only created asset');
    { const r = await u.h1m.client.from('assets').insert({ hotel_id: HT.h1, bucket_name: 'public-media', storage_path: `hotels/${HT.h1}/news.jpg`, asset_type: 'newsletter_asset', file_size_bytes: 1000 }).select('id').single(); (!denied(r)) ? ok('marketing can create newsletter asset') : bad(`marketing asset create failed: ${r.error?.message}`); if (r.data) ids.push(r.data.id); }
    // asset usage tracking + cross-hotel usage rejected
    { const r = await u.h1a.client.from('asset_usages').insert({ asset_id: AS.logo, hotel_id: HT.h1, entity_type: 'hotel', entity_id: HT.h1, usage_role: 'logo' }).select('id').single(); (!denied(r)) ? ok('asset usage attached') : bad(`usage attach failed: ${r.error?.message}`); if (r.data) ids.push(r.data.id); }
    denied(await svc.from('asset_usages').insert({ asset_id: AS.logo, hotel_id: HT.h2, entity_type: 'hotel', entity_id: HT.h2, usage_role: 'logo' })) ? ok('cross-hotel usage of a hotel asset rejected') : bad('cross-hotel usage allowed');
    { const rep = (await u.h1a.client.rpc('asset_usage_report', { p_asset: AS.logo })).data || []; (rep.length >= 1 && rep[0].usage_role === 'logo') ? ok('asset_usage_report answers "where is this used?"') : bad('usage report wrong'); }
    // soft delete blocked while usages exist
    { const e = (await svc.from('assets').update({ deleted_at: new Date().toISOString() }).eq('id', AS.logo)).error?.message;
      (e && /active usages/i.test(e)) ? ok('soft-delete blocked while active usages exist') : bad(`soft-delete not blocked: ${e}`); }
    await svc.from('asset_usages').delete().eq('asset_id', AS.logo);
    { const e = (await svc.from('assets').update({ deleted_at: new Date().toISOString() }).eq('id', AS.logo)).error?.message; (!e) ? ok('soft-delete allowed after detaching usages') : bad(`soft-delete still blocked: ${e}`); }
    // Storage object RLS: anon denied upload to private; service_role round-trip; hotel path validation
    { const r = await anon.storage.from('consent-files').upload(`hotels/${HT.h1}/anon.png`, blob()); denied(r) ? ok('anon cannot upload to private bucket') : (bad('anon uploaded to private bucket'), spaths.push(`consent-files:hotels/${HT.h1}/anon.png`)); }
    { const path = `hotels/${HT.h1}/consents/test/sig.png`; const r = await svc.storage.from('consent-files').upload(path, blob(), { upsert: true }); if (!r.error) { spaths.push(`consent-files:${path}`); const su = await svc.storage.from('consent-files').createSignedUrl(path, 60); (!su.error && su.data?.signedUrl) ? ok('service_role uploads private file + mints signed URL') : bad('signed URL failed'); } else bad(`service_role private upload failed: ${r.error.message}`); }
    { const path = `hotels/${HT.h1}/media/ok.png`; const r = await u.h1a.client.storage.from('public-media').upload(path, blob(), { upsert: true }); if (!r.error) { spaths.push(`public-media:${path}`); ok('hotel_admin uploads to own-hotel public path'); } else bad(`own-path upload failed: ${r.error.message}`); }
    { const r = await u.h1a.client.storage.from('public-media').upload(`hotels/${HT.h2}/media/hack.png`, blob()); denied(r) ? ok('hotel_admin denied upload to another hotel path (path validation)') : (bad('cross-hotel path upload allowed'), spaths.push(`public-media:hotels/${HT.h2}/media/hack.png`)); }
    { const r = await anon.storage.from('public-media').upload(`hotels/${HT.h1}/media/anon.png`, blob()); denied(r) ? ok('anon cannot upload to public-media') : (bad('anon uploaded to public-media'), spaths.push(`public-media:hotels/${HT.h1}/media/anon.png`)); }

    // ══ STEP 12 — NEWSLETTER ═══════════════════════════════════════════════════
    // consent for a subscriber (granted) via a published template + consent row
    G.g1 = await ins('guests', { hotel_id: HT.h1, first_name: 'Sub', last_name: 'Scriber' });
    CT.t1 = await ins('consent_templates', { hotel_id: HT.h1, key: `${P}-mkt`, locale: 'en', version: 1, title: 'Mkt', body_text: '[SYNTH]', status: 'published', published_at: new Date().toISOString() });
    CO.c1 = await ins('consents', { hotel_id: HT.h1, guest_id: G.g1, template_id: CT.t1, consent_type: `${P}-mkt`, consent_version: 1, locale: 'en', consent_text_snapshot: '[SYNTH]', signed_name: 'Sub Scriber', status: 'granted' });
    // subscribers: normalization + uniqueness
    SUB.a = await ins('newsletter_subscribers', { hotel_id: HT.h1, email: 'Sub.One@Verify.Local', locale: 'en', status: 'subscribed', consent_id: CO.c1 });
    ((await svc.from('newsletter_subscribers').select('email_normalized').eq('id', SUB.a).single()).data.email_normalized === 'sub.one@verify.local') ? ok('subscriber email normalized (lowercased)') : bad('email not normalized');
    denied(await svc.from('newsletter_subscribers').insert({ hotel_id: HT.h1, email: 'SUB.ONE@verify.local', status: 'subscribed' })) ? ok('subscriber unique per (hotel, normalized email)') : bad('duplicate subscriber allowed');
    SUB.b = await ins('newsletter_subscribers', { hotel_id: HT.h1, email: `${P}.noconsent@verify.local`, status: 'subscribed' });               // subscribed, NO consent
    SUB.c = await ins('newsletter_subscribers', { hotel_id: HT.h1, email: `${P}.left@verify.local`, status: 'unsubscribed', consent_id: CO.c1 }); // consented but unsubscribed
    // segments: rule validation
    SEG.static = await ins('newsletter_segments', { hotel_id: HT.h1, key: `${P}-all`, name: 'All', type: 'static' });
    await svc.from('newsletter_segment_members').insert([{ segment_id: SEG.static, subscriber_id: SUB.a }, { segment_id: SEG.static, subscriber_id: SUB.b }, { segment_id: SEG.static, subscriber_id: SUB.c }]);
    denied(await svc.from('newsletter_segments').insert({ hotel_id: HT.h1, key: `${P}-bad`, name: 'Bad', type: 'rule', rules: { conditions: [{ field: 'DROP TABLE', op: 'eq', value: 'x' }] } })) ? ok('invalid segment rule field rejected (no arbitrary SQL)') : bad('unsafe segment rule accepted');
    denied(await svc.from('newsletter_segments').insert({ hotel_id: HT.h1, key: `${P}-bad2`, name: 'Bad2', type: 'rule', rules: { conditions: [{ field: 'locale', op: 'like', value: 'x' }] } })) ? ok('invalid segment rule op rejected') : bad('unsafe segment op accepted');
    SEG.rule = await ins('newsletter_segments', { hotel_id: HT.h1, key: `${P}-en`, name: 'EN', type: 'rule', rules: { match: 'all', conditions: [{ field: 'locale', op: 'eq', value: 'en' }] } });
    // audience resolution filters consent + status
    { const aud = (await u.h1m.client.rpc('resolve_newsletter_audience', { p_segment: SEG.static })).data || [];
      const idset = aud.map(x => x.subscriber_id);
      (idset.includes(SUB.a) && !idset.includes(SUB.b) && !idset.includes(SUB.c)) ? ok('audience requires active consent AND subscribed (no-consent + unsubscribed excluded)') : bad(`audience wrong: ${JSON.stringify(idset)}`); }
    // templates: publish/version + direct-publish block
    TPL.t = await ins('newsletter_templates', { hotel_id: HT.h1, key: `${P}-welcome`, name: 'W', subject: 'Hi', content: { version: 1, blocks: [{ type: 'paragraph', text: 'hi' }] }, locale: 'en', status: 'draft' });
    { const e = (await u.h1m.client.from('newsletter_templates').update({ status: 'published' }).eq('id', TPL.t)).error?.message;
      ((await svc.from('newsletter_templates').select('status').eq('id', TPL.t).single()).data.status === 'draft' && e && /direct publish/i.test(e)) ? ok('direct template publish blocked (use RPC)') : bad('direct template publish not blocked'); }
    { const r = await u.h1m.client.rpc('publish_newsletter_template', { p_template: TPL.t, p_change_summary: 'v1' });
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='newsletter_template' and entity_id=$1`, [TPL.t])).rows[0].c;
      (!r.error && v === 1) ? ok('marketing publish_newsletter_template -> immutable version') : bad(`template publish wrong: v=${v} err=${r.error?.message}`); }
    // campaigns: schedule freezes snapshot; reception cannot send; snapshot immutable after scheduling
    CMP.c = await ins('newsletter_campaigns', { hotel_id: HT.h1, name: 'C', template_id: TPL.t, segment_id: SEG.static, status: 'draft' });
    { const r = await u.h1r.client.rpc('schedule_campaign', { p_campaign: CMP.c, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      (r.error && /privilege/i.test(r.error.message)) ? ok('reception cannot schedule/send a campaign') : bad('reception scheduled a campaign'); }
    { const r = await u.h1m.client.rpc('schedule_campaign', { p_campaign: CMP.c, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      const c = await svc.from('newsletter_campaigns').select('status,subject_snapshot,content_snapshot').eq('id', CMP.c).single();
      (!r.error && c.data.status === 'scheduled' && c.data.subject_snapshot === 'Hi' && c.data.content_snapshot) ? ok('schedule_campaign freezes template snapshot') : bad(`schedule wrong: ${JSON.stringify(c.data)} err=${r.error?.message}`); }
    { await u.h1m.client.from('newsletter_campaigns').update({ subject_snapshot: 'TAMPER', content_snapshot: { hacked: true } }).eq('id', CMP.c);
      const c = (await svc.from('newsletter_campaigns').select('subject_snapshot').eq('id', CMP.c).single()).data;
      (c.subject_snapshot === 'Hi') ? ok('scheduled campaign snapshot immutable (later edits ignored)') : bad('scheduled snapshot mutated'); }
    // later template change must not alter scheduled campaign
    await svc.from('newsletter_templates').update({ subject: 'CHANGED' }).eq('id', TPL.t);
    ((await svc.from('newsletter_campaigns').select('subject_snapshot').eq('id', CMP.c).single()).data.subject_snapshot === 'Hi') ? ok('template change does not alter a scheduled campaign') : bad('scheduled campaign followed template');
    // append-only events + idempotent webhook ingestion + no real brevo
    { const ev = await ins('newsletter_events', { hotel_id: HT.h1, campaign_id: CMP.c, event_type: 'delivered' });
      denied(await svc.from('newsletter_events').update({ event_type: 'opened' }).eq('id', ev)) ? ok('newsletter_events append-only (UPDATE blocked)') : bad('newsletter_events mutable'); }
    { await svc.from('newsletter_webhook_events').insert({ hotel_id: HT.h1, provider: 'brevo', provider_event_id: `${P}-evt-1`, event_type: 'delivered', payload: { redacted: true } });
      denied(await svc.from('newsletter_webhook_events').insert({ hotel_id: HT.h1, provider: 'brevo', provider_event_id: `${P}-evt-1`, event_type: 'delivered' })) ? ok('webhook ingestion idempotent (provider_event_id unique)') : bad('duplicate webhook accepted'); }
    ((await svc.from('newsletter_campaigns').select('brevo_campaign_id').eq('id', CMP.c).single()).data.brevo_campaign_id === null) ? ok('no Brevo campaign id set (no real send performed)') : bad('brevo id populated');
    // cross-tenant + PII exposure
    (data(await u.h2a.client.from('newsletter_subscribers').select('id').eq('id', SUB.a)).length === 0) ? ok('subscribers cross-tenant isolated') : bad('cross-hotel subscriber leak');
    (data(await anon.from('newsletter_subscribers').select('id')).length === 0) ? ok('anon cannot read subscribers (PII protected)') : bad('anon read subscribers');
    (data(await u.h1e.client.from('newsletter_subscribers').select('id')).length === 0) ? ok('editor cannot read subscribers (PII)') : bad('editor read subscribers');

    // ══ STEP 13 — ANALYTICS ════════════════════════════════════════════════════
    const day = (await q(`select to_char((now() at time zone 'Europe/Zagreb'), 'YYYY-MM-DD') d`)).rows[0].d;  // text, avoids JS Date TZ off-by-one
    await ins('ai_response_logs', { hotel_id: HT.h1, question: 'q1', answer: 'a1', route_type: 'knowledge', deterministic_handler: 'wifi', handoff: false, latency_ms: 100, prompt_tokens: 10, completion_tokens: 5 });
    await ins('ai_response_logs', { hotel_id: HT.h1, question: 'q2', answer: 'a2', route_type: 'gpt', handoff: true, latency_ms: 300, prompt_tokens: 20, completion_tokens: 8 });
    { const r = await u.h1a.client.rpc('refresh_ai_quality_daily', { p_hotel: HT.h1, p_day: day });
      const d = r.data;
      (!r.error && d.total_questions >= 2 && d.safe_handoffs >= 1 && d.deterministic_answers >= 1 && d.calc_version === 'v1' && Number(d.coverage_estimate) > 0) ? ok('refresh_ai_quality_daily aggregates AI inputs (tz-bucketed, calc_version stamped)') : bad(`ai_quality wrong: ${JSON.stringify(d)} err=${r.error?.message}`); }
    // idempotent refresh
    { const before = (await svc.from('ai_quality_daily').select('total_questions').eq('hotel_id', HT.h1).eq('day', day).single()).data.total_questions;
      await u.h1a.client.rpc('refresh_ai_quality_daily', { p_hotel: HT.h1, p_day: day });
      const cnt = (await q(`select count(*)::int c from public.ai_quality_daily where hotel_id=$1 and day=$2`, [HT.h1, day])).rows[0].c;
      const after = (await svc.from('ai_quality_daily').select('total_questions').eq('hotel_id', HT.h1).eq('day', day).single()).data.total_questions;
      (cnt === 1 && after === before) ? ok('refresh is idempotent (upsert, no duplicate rows)') : bad(`refresh not idempotent: rows=${cnt}`); }
    // operations + content-health inputs
    await svc.from('guest_requests').insert({ hotel_id: HT.h1, request_type: 'x', title: 'y', status: 'resolved', acknowledged_at: new Date().toISOString(), resolved_at: new Date().toISOString() });
    { const r = await u.h1a.client.rpc('refresh_operations_daily', { p_hotel: HT.h1, p_day: day }); (!r.error && r.data.requests_total >= 1) ? ok('refresh_operations_daily aggregates reception metrics') : bad(`ops wrong: ${r.error?.message}`); }
    { const r = await u.h1a.client.rpc('refresh_content_health_daily', { p_hotel: HT.h1, p_day: day }); (!r.error && r.data.calc_version === 'v1' && r.data.completeness_score !== undefined) ? ok('refresh_content_health_daily computes completeness (versioned formula)') : bad(`content-health wrong: ${r.error?.message}`); }
    { const r = await u.h1m.client.rpc('refresh_newsletter_daily', { p_hotel: HT.h1, p_day: day }); (!r.error && r.data.subscribers_active >= 1 && r.data.consent_active >= 1) ? ok('refresh_newsletter_daily aggregates subscriber/consent metrics') : bad(`newsletter analytics wrong: ${r.error?.message}`); }
    // role-specific analytics access
    (data(await u.h1e.client.from('ai_quality_daily').select('hotel_id').eq('hotel_id', HT.h1)).length >= 1) ? ok('editor reads AI-quality analytics') : bad('editor cannot read ai_quality');
    (data(await u.h1e.client.from('operations_daily').select('hotel_id').eq('hotel_id', HT.h1)).length === 0) ? ok('editor cannot read operations analytics (role-scoped)') : bad('editor read operations analytics');
    (data(await u.h1r.client.from('operations_daily').select('hotel_id').eq('hotel_id', HT.h1)).length >= 1) ? ok('reception reads operations analytics') : bad('reception cannot read operations analytics');
    (data(await u.h1m.client.from('newsletter_daily').select('hotel_id').eq('hotel_id', HT.h1)).length >= 1) ? ok('marketing reads newsletter analytics') : bad('marketing cannot read newsletter analytics');
    (data(await u.h1m.client.from('ai_quality_daily').select('hotel_id').eq('hotel_id', HT.h1)).length === 0) ? ok('marketing cannot read AI-quality analytics (role-scoped)') : bad('marketing read ai_quality');
    (data(await u.h2a.client.from('ai_quality_daily').select('hotel_id').eq('hotel_id', HT.h1)).length === 0) ? ok('analytics tenant-isolated (no cross-hotel leak)') : bad('cross-hotel analytics leak');
    (data(await anon.from('ai_quality_daily').select('hotel_id')).length === 0) ? ok('anon cannot read analytics') : bad('anon read analytics');
    // no PII columns in aggregates
    { const cols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name in ('ai_quality_daily','operations_daily','newsletter_daily','content_health_daily')`)).rows.map(r => r.column_name);
      // token COUNTS (prompt_tokens/completion_tokens) are usage metrics, not secrets
      (!cols.some(c => /email|phone|first_name|last_name|signature|endpoint|password|access_token|ip_address/i.test(c))) ? ok('analytics aggregates carry no PII/secret columns') : bad(`analytics has PII-like column: ${cols.filter(c => /email|phone|first_name|last_name|signature|endpoint|password|access_token|ip_address/i.test(c))}`); }

    // ══ GLOBAL — audit redaction ═══════════════════════════════════════════════
    { const rows = (await q(`select coalesce(before_state::text,'')||coalesce(after_state::text,'')||coalesce(metadata::text,'') s from public.audit_log where hotel_id=$1`, [HT.h1])).rows.map(r => r.s).join('||');
      const leaks = ['sub.one@verify.local', `${P}.noconsent@verify.local`, `hotels/${HT.h1}/logo.png`, `hotels/${HT.h1}/consents`, 'signedUrl', '[SYNTH]'];
      const found = leaks.filter(x => rows.includes(x));
      (found.length === 0) ? ok('audit snapshots contain NO emails/paths/signed-URLs/consent-text') : bad(`audit leaked: ${found.join(', ')}`); }
    { const acts = new Set((await q(`select action from public.audit_log where entity_type='asset' and hotel_id=$1`, [HT.h1])).rows.map(r => r.action)); (acts.size >= 1) ? ok('asset metadata/usage changes audited (redacted)') : bad('assets not audited'); }
    { const c = (await q(`select count(*)::int c from public.audit_log where entity_type='newsletter_campaign' and hotel_id=$1`, [HT.h1])).rows[0].c; (c >= 1) ? ok('campaign scheduling audited') : bad('campaign not audited'); }
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + auth users + storage objects cleaned up. No real emails sent; no secrets logged; no production writes.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('  verify error:', e.message); process.exit(1); });

// ============================================================================
// AI OLLY Platform 2.0 — Step 1 verification (DEV ONLY, aiolly-dev)
// ----------------------------------------------------------------------------
// Verifies the cross-cutting schema: object existence, RLS posture, privileges,
// uniqueness/immutability constraints, and role-based denial. Uses only
// synthetic data (entity_type/data_type = 'verify.step1') and cleans it up.
// Reveals no secrets. Makes no production writes. Run: npm run verify:supabase:step1
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { getSupabaseServerClient } from '../server/data/supabase/client.js';

const TABLES = ['translations', 'content_versions', 'audit_log', 'retention_policies'];
const BUSINESS_TABLES = ['hotels', 'rooms', 'services', 'pois', 'guests', 'stays', 'destinations', 'hotel_memberships'];
const TAG = 'verify.step1';
const ENTITY_ID = '00000000-0000-4000-8000-000000000001';

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const expectErr = (res, m) => (res && res.error ? ok(`${m} (denied as expected)`) : bad(`${m} — expected an error but it succeeded`));
const expectOk  = (res, m) => (res && !res.error ? ok(m) : bad(`${m} — ${res && res.error && res.error.message}`));

async function main() {
  console.log('AI OLLY — Step 1 verification (aiolly-dev)\n');

  const DBURL = process.env.SUPABASE_DB_URL;
  if (!DBURL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('  Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL in .env.');
    process.exit(1);
  }

  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();
  const q = (text, params) => sql.query(text, params);
  const svc = getSupabaseServerClient(); // service-role (bypasses RLS)

  try {
    // ── 1) platform_health still works ──────────────────────────────────────
    const health = await svc.rpc('platform_health');
    health.error ? bad('platform_health RPC') : ok('platform_health RPC still works');

    // ── 2) all 4 objects exist ──────────────────────────────────────────────
    for (const t of TABLES) {
      const r = await q(`select to_regclass('public.'||$1) is not null as ex`, [t]);
      r.rows[0].ex ? ok(`table public.${t} exists`) : bad(`table public.${t} missing`);
    }

    // ── 3) RLS enabled + zero policies (fail-closed) ────────────────────────
    for (const t of TABLES) {
      const rls = await q(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t]);
      rls.rows[0] && rls.rows[0].relrowsecurity ? ok(`RLS enabled on ${t}`) : bad(`RLS NOT enabled on ${t}`);
      const pol = await q(`select count(*)::int c from pg_policies where schemaname='public' and tablename=$1`, [t]);
      pol.rows[0].c === 0 ? ok(`${t} has 0 policies (deny-by-default)`) : bad(`${t} has ${pol.rows[0].c} policies (expected 0 in Step 1)`);
    }

    // ── 4) anon/authenticated have NO grants (structural denial proof) ──────
    for (const t of TABLES) {
      const g = await q(
        `select count(*)::int c from information_schema.role_table_grants
         where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')`, [t]);
      g.rows[0].c === 0 ? ok(`${t}: no grants to anon/authenticated`) : bad(`${t}: ${g.rows[0].c} grants leaked to anon/authenticated`);
    }

    // ── 5) service_role has expected least-privilege grants ─────────────────
    const expected = {
      translations: 'DELETE,INSERT,SELECT,UPDATE',
      content_versions: 'INSERT,SELECT',
      audit_log: 'INSERT,SELECT',
      retention_policies: 'INSERT,SELECT,UPDATE',
    };
    for (const t of TABLES) {
      const g = await q(
        `select string_agg(privilege_type, ',' order by privilege_type) p
         from information_schema.role_table_grants
         where table_schema='public' and table_name=$1 and grantee='service_role'`, [t]);
      (g.rows[0].p || '') === expected[t]
        ? ok(`${t}: service_role grants = ${g.rows[0].p}`)
        : bad(`${t}: service_role grants = ${g.rows[0].p} (expected ${expected[t]})`);
    }

    // ── 6) no business-domain tables accidentally created ───────────────────
    const bt = await q(
      `select count(*)::int c from pg_tables where schemaname='public' and tablename = any($1)`, [BUSINESS_TABLES]);
    bt.rows[0].c === 0 ? ok('no business-domain tables present (as expected)') : bad(`found ${bt.rows[0].c} business-domain tables — should be none in Step 1`);

    // ── 7) service-role functional: inserts allowed ─────────────────────────
    expectOk(await svc.from('translations').insert({ entity_type: TAG, entity_id: ENTITY_ID, field_key: 'name', locale: 'EN', value: 'hello' }),
      'service_role can insert a translation');
    // locale normalized to lowercase
    {
      const r = await svc.from('translations').select('locale').eq('entity_type', TAG).eq('field_key', 'name').single();
      r.data && r.data.locale === 'en' ? ok("locale normalized to 'en'") : bad(`locale not normalized (${r.data && r.data.locale})`);
    }
    expectErr(await svc.from('translations').insert({ entity_type: TAG, entity_id: ENTITY_ID, field_key: 'name', locale: 'en', value: 'dup' }),
      'translations uniqueness (entity_type+entity_id+field_key+locale)');

    expectOk(await svc.from('content_versions').insert({ entity_type: TAG, entity_id: ENTITY_ID, version_number: 1, status: 'published', snapshot: { a: 1 } }),
      'service_role can insert a content_version');
    expectErr(await svc.from('content_versions').insert({ entity_type: TAG, entity_id: ENTITY_ID, version_number: 1, snapshot: { a: 2 } }),
      'content_versions version-number uniqueness');
    expectErr(await svc.from('content_versions').update({ change_summary: 'x' }).eq('entity_type', TAG),
      'content_versions immutable (UPDATE denied for service_role)');

    expectOk(await svc.from('audit_log').insert({ entity_type: TAG, entity_id: ENTITY_ID, action: 'create', actor_type: 'service' }),
      'service_role can append to audit_log');
    expectErr(await svc.from('audit_log').update({ user_agent: 'x' }).eq('entity_type', TAG),
      'audit_log immutable (UPDATE denied for service_role)');
    expectErr(await svc.from('audit_log').delete().eq('entity_type', TAG),
      'audit_log append-only (DELETE denied for service_role)');

    expectOk(await svc.from('retention_policies').insert({ data_type: TAG, action: 'delete', retention_days: 30 }),
      'service_role can insert a retention_policy');
    expectErr(await svc.from('retention_policies').insert({ data_type: TAG, action: 'delete', retention_days: -1 }),
      'retention_policies validation (retention_days >= 0)');

    // ── 8) anon / authenticated functional denial (only if anon key present) ─
    if (process.env.SUPABASE_ANON_KEY) {
      const { createClient } = await import('@supabase/supabase-js');
      const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const rSel = await anon.from('translations').select('id').limit(1);
      (rSel.error || (rSel.data && rSel.data.length === 0)) ? ok('anon cannot read translations') : bad('anon READ leaked');
      expectErr(await anon.from('translations').insert({ entity_type: TAG, entity_id: ENTITY_ID, field_key: 'x', locale: 'en', value: 'y' }),
        'anon cannot write translations');
    } else {
      console.log('  • anon/authenticated functional test SKIPPED (SUPABASE_ANON_KEY not set).');
      console.log('    Denial is proven structurally above: RLS enabled + 0 policies + 0 grants to anon/authenticated.');
    }
  } finally {
    // ── cleanup synthetic rows via owner connection (append-only tables too) ─
    for (const t of ['translations', 'content_versions', 'audit_log']) {
      await q(`delete from public.${t} where entity_type = $1`, [TAG]).catch(() => {});
    }
    await q(`delete from public.retention_policies where data_type = $1`, [TAG]).catch(() => {});
    await sql.end();
  }

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data cleaned up. No production writes.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('  verify error:', e.message); process.exit(1); });

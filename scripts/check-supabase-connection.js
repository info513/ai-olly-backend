// ============================================================================
// AI OLLY Platform 2.0 — Supabase connection health check (DEV ONLY)
// ----------------------------------------------------------------------------
// Run:  node scripts/check-supabase-connection.js   (or: npm run check:supabase)
//
// Purpose: prove the backend can reach Supabase. It:
//   • validates required env vars (reports which are MISSING, never their values)
//   • connects with the server-side (service-role) client
//   • runs a harmless query — the public.platform_health() RPC from the
//     foundation migration (returns a status object only, no data)
//   • reports success/failure and exits non-zero on failure
//
// It makes NO production-data changes, exposes NO secrets, and is not an HTTP
// endpoint. If credentials are absent it fails clearly (expected before Ivan
// provisions the dev project).
// ============================================================================

import 'dotenv/config';
import { getSupabaseServerClient, missingSupabaseEnv } from '../server/data/supabase/client.js';

async function main() {
  console.log('AI OLLY — Supabase connection check (dev only)\n');

  const missing = missingSupabaseEnv();
  if (missing.length) {
    console.error('✗ Missing configuration. Set these in .env / Render (names only):');
    for (const k of missing) console.error(`    - ${k}`);
    console.error('\n  See .env.example and docs/SUPABASE_SETUP_GUIDE.md.');
    process.exit(1);
  }

  // Never print secret values — only confirm presence + the (public) URL host.
  let host = 'unknown';
  try { host = new URL(process.env.SUPABASE_URL).host; } catch { /* ignore */ }
  console.log(`  URL host   : ${host}`);
  console.log('  Service key: present (hidden)\n');

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc('platform_health');
    if (error) {
      console.error('✗ Connected to Supabase but the health RPC failed:');
      console.error(`    ${error.message}`);
      console.error('  If it says the function is missing, apply the foundation migration:');
      console.error('    supabase db reset   (local)   or   supabase db push   (linked project)');
      process.exit(2);
    }
    console.log('✓ Supabase reachable. platform_health() ->', JSON.stringify(data));
    console.log('\n  Connection OK. No data was written. Airtable remains the live data provider.');
    process.exit(0);
  } catch (e) {
    console.error('✗ Could not connect to Supabase:');
    console.error(`    ${e.message}`);
    process.exit(3);
  }
}

main();

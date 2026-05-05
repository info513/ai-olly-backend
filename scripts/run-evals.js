/**
 * AI OLLY — Production Eval Runner
 * Usage: npm run eval:prod
 *
 * Reads active tests from AI_EVAL_TESTS, fires each one against the live
 * production endpoint, checks must-contain / must-not-contain / safe-handoff
 * assertions, writes Last Run / Last Result / Last Answer / Last Error back
 * to Airtable, and prints a pass-rate summary.
 *
 * DOES NOT modify routing, answer logic, or any frontend.
 */

import 'dotenv/config';
import Airtable from 'airtable';

// ── Config ────────────────────────────────────────────────────────────────────
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appon9UYjX6KU9cr1';
const BASE_URL         = process.env.EVAL_BASE_URL    || 'https://app.aiolly.pressmax.net';
const REQUEST_TIMEOUT  = 20_000; // ms

const TABLE_EVAL_TESTS = 'AI_EVAL_TESTS';
const TABLE_ROOM_GUIDE = 'ROOM GUIDE';

if (!AIRTABLE_API_KEY) {
  console.error('❌  AIRTABLE_API_KEY is not set in .env');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safe-handoff detector — mirrors the logic in server.js so the eval
 * can check whether a safe-handoff answer was actually returned.
 */
function isSafeHandoff(answer) {
  if (!answer) return false;
  const a = answer.toLowerCase();
  return (
    a.includes("don't have that information in the system")   ||
    a.includes("don't have confirmed information about that") ||
    a.includes("please contact reception for exact details")  ||
    a.includes("please contact reception for a quote")        ||
    a.includes("price is not available in the system")        ||
    a.includes("contact reception")                           ||
    a.includes("nemam taj podatak u sustavu")                 ||
    a.includes("kontaktirajte recepciju za točne informacije")
  );
}

/**
 * Load room → accessToken map for a given hotel slug.
 * Reads 'Naziv sobe' (room number) and 'Access Token' fields from ROOM GUIDE.
 */
async function loadRoomTokens(slug) {
  const tokenMap = {};
  try {
    const records = await base(TABLE_ROOM_GUIDE)
      .select({
        filterByFormula: `FIND('${slug.replace(/'/g, "\\'")}', ARRAYJOIN({Hotel Slug}, ',')) > 0`,
        fields: ['Naziv sobe', 'Access Token'],
      })
      .all();
    for (const rec of records) {
      const room  = String(rec.fields['Naziv sobe']   || '').trim();
      const token = String(rec.fields['Access Token'] || '').trim();
      if (room && token) tokenMap[room] = token;
    }
  } catch (e) {
    console.warn(`  ⚠️  Could not load tokens for "${slug}": ${e.message}`);
  }
  return tokenMap;
}

/**
 * Load all active eval tests from AI_EVAL_TESTS.
 */
async function loadTests() {
  const records = await base(TABLE_EVAL_TESTS)
    .select({ filterByFormula: '{Active} = TRUE()' })
    .all();
  return records;
}

/**
 * Call a single endpoint and return the raw JSON body (or throw).
 */
async function callEndpoint(endpoint, body) {
  const res = await fetch(`${BASE_URL}/api/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  return res.json();
}

/**
 * Run one test record; return { result, answer, error, latencyMs }.
 */
async function runTest(test, tokensBySlug) {
  const f        = test.fields;
  const endpoint = (f['Endpoint'] || 'pwa-ask').trim();
  const slug     = (f['Hotel Slug'] || '').trim();
  const room     = String(f['Room'] || '').trim();
  const question = (f['Question']   || '').trim();

  const mustContain    = (f['Must Contain']     || '').split('\n').map(s => s.trim()).filter(Boolean);
  const mustNotContain = (f['Must Not Contain'] || '').split('\n').map(s => s.trim()).filter(Boolean);
  const expectSafeHO   = f['Expected Safe Handoff'] === true;

  const body = { slug, question };
  if (endpoint === 'pwa-ask') {
    body.room  = room;
    body.token = (tokensBySlug[slug] || {})[room] || '';
  }

  const started = Date.now();
  let data, fetchError;

  try {
    data = await callEndpoint(endpoint, body);
  } catch (e) {
    return { result: 'ERROR', answer: '', error: e.message, latencyMs: Date.now() - started };
  }

  const latencyMs = Date.now() - started;

  if (!data?.ok) {
    return {
      result:    'ERROR',
      answer:    data?.answer || '',
      error:     `Non-ok response: ${JSON.stringify(data).slice(0, 200)}`,
      latencyMs,
    };
  }

  const answer      = data.answer || '';
  const answerLower = answer.toLowerCase();

  // Must-contain assertions
  for (const term of mustContain) {
    if (!answerLower.includes(term.toLowerCase())) {
      return { result: 'FAIL', answer, error: `Missing required term: "${term}"`, latencyMs };
    }
  }

  // Must-not-contain assertions
  for (const term of mustNotContain) {
    if (term && answerLower.includes(term.toLowerCase())) {
      return { result: 'FAIL', answer, error: `Contains forbidden term: "${term}"`, latencyMs };
    }
  }

  // Safe-handoff assertion
  const actualSafeHO = isSafeHandoff(answer);
  if (expectSafeHO && !actualSafeHO) {
    return {
      result:    'FAIL',
      answer,
      error:     'Expected safe-handoff answer but got a substantive response',
      latencyMs,
    };
  }

  return { result: 'PASS', answer, error: '', latencyMs };
}

/**
 * Write Last Run / Last Result / Last Answer / Last Error back to Airtable.
 * Uses batches of 10 (Airtable limit for update is 10 per call).
 */
async function writeResultsBack(updates) {
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH).map(u => ({
      id:     u.id,
      fields: {
        'Last Run':    u.lastRun,
        'Last Result': u.result,
        'Last Answer': u.answer.slice(0, 3000),
        'Last Error':  u.error.slice(0, 1000),
      },
    }));
    await base(TABLE_EVAL_TESTS).update(batch);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const runTs = new Date().toISOString();
  console.log(`\n🔬  AI OLLY EVAL  —  ${runTs}`);
  console.log(`    Target : ${BASE_URL}`);
  console.log(`    Table  : ${TABLE_EVAL_TESTS}\n`);

  // 1. Load tests
  const tests = await loadTests();
  if (!tests.length) {
    console.log('  No active tests found. Done.\n');
    return;
  }
  console.log(`  Loaded ${tests.length} active tests\n`);

  // 2. Load tokens once per unique slug
  const slugs       = [...new Set(tests.map(t => (t.fields['Hotel Slug'] || '').trim()))];
  const tokensBySlug = {};
  for (const slug of slugs) {
    tokensBySlug[slug] = await loadRoomTokens(slug);
    const count = Object.keys(tokensBySlug[slug]).length;
    console.log(`  Loaded ${count} room token(s) for "${slug}"`);
  }
  console.log();

  // 3. Run each test
  const counters = { PASS: 0, FAIL: 0, ERROR: 0 };
  const updates  = [];

  for (const test of tests) {
    const id       = test.fields['Test ID'] || test.id;
    const question = (test.fields['Question'] || '').slice(0, 55).padEnd(55);
    const category = (test.fields['Category'] || '').padEnd(16);

    process.stdout.write(`  [${String(id).padEnd(5)}] ${category} ${question} `);

    const r = await runTest(test, tokensBySlug);
    counters[r.result] = (counters[r.result] || 0) + 1;

    const icon = r.result === 'PASS' ? '✅' : r.result === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} ${r.result.padEnd(5)}  ${r.latencyMs}ms`);
    if (r.result !== 'PASS' && r.error) {
      console.log(`         └─ ${r.error}`);
    }

    updates.push({ id: test.id, lastRun: runTs, result: r.result, answer: r.answer, error: r.error });
  }

  // 4. Write results back
  process.stdout.write('\n  Writing results back to Airtable … ');
  await writeResultsBack(updates);
  console.log('done\n');

  // 5. Summary
  const total    = tests.length;
  const passRate = ((counters.PASS / total) * 100).toFixed(1);
  const bar      = '━'.repeat(57);
  console.log(bar);
  console.log(`  RESULTS : ${counters.PASS}/${total} PASS  (${passRate}%)  |  FAIL: ${counters.FAIL}  |  ERROR: ${counters.ERROR}`);
  console.log(bar);

  // Categorised breakdown
  const byCategory = {};
  for (const test of tests) {
    const cat = test.fields['Category'] || 'Unknown';
    if (!byCategory[cat]) byCategory[cat] = { PASS: 0, FAIL: 0, ERROR: 0 };
    const u = updates.find(u => u.id === test.id);
    if (u) byCategory[cat][u.result] = (byCategory[cat][u.result] || 0) + 1;
  }
  console.log('\n  By category:');
  for (const [cat, c] of Object.entries(byCategory)) {
    const total = c.PASS + c.FAIL + c.ERROR;
    const pct   = ((c.PASS / total) * 100).toFixed(0);
    console.log(`    ${cat.padEnd(20)} ${c.PASS}/${total}  (${pct}%)`);
  }
  console.log();

  if (counters.FAIL + counters.ERROR > 0) process.exit(1);
}

main().catch(e => { console.error('\n❌  Fatal:', e.message || e); process.exit(1); });

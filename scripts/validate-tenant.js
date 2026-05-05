/**
 * AI OLLY — Tenant Validation Script
 * Usage: TENANT_SLUG=antique-split npm run validate:tenant
 *
 * Checks that a hotel tenant is fully configured in Airtable.
 * Writes results back to AI_TENANT_ONBOARDING checklist.
 * Never modifies source data — read-only except for AI_TENANT_ONBOARDING.
 *
 * Exit 0 = PASS (warnings allowed)
 * Exit 1 = FAIL (at least one Critical or High check failed)
 */

import 'dotenv/config';
import Airtable from 'airtable';

// ── Config ────────────────────────────────────────────────────────────────────
const SLUG = (process.env.TENANT_SLUG || '').trim();

if (!SLUG) {
  console.error('❌  TENANT_SLUG env var is required.\n    Example: TENANT_SLUG=antique-split npm run validate:tenant');
  process.exit(1);
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appon9UYjX6KU9cr1';

if (!AIRTABLE_API_KEY) {
  console.error('❌  AIRTABLE_API_KEY is not set in .env');
  process.exit(1);
}

Airtable.configure({ apiKey: AIRTABLE_API_KEY });
const base = Airtable.base(AIRTABLE_BASE_ID);

// ── Airtable Table Names ───────────────────────────────────────────────────
const T_HOTELS   = 'HOTELI';
const T_ROOMS    = 'ROOM GUIDE';
const T_SERVICES = 'SERVICES';
const T_INTENTS  = 'AI_INTENT_PATTERNS';
const T_EVAL     = 'AI_EVAL_TESTS';
const T_LINT     = 'AI_CONTENT_LINT';
const T_ONBOARD  = 'AI_TENANT_ONBOARDING';

// AI_CONTENT_LINT field IDs (from lint-content.js creation)
const F_LINT_SLUG     = 'fldRNukPCdiIjmYlI';
const F_LINT_SEVERITY = 'fldarZrMNrCVOXrEv';
const F_LINT_STATUS   = 'fldMu3sLkl3vQ1ptj';

// AI_TENANT_ONBOARDING field IDs (from table creation)
const F_OB = {
  tenantSlug:  'fldOUkb8QgdzJmSoO',
  step:        'fldKAZM2Y5WLMowXP',
  stepName:    'fldNILA5iQjoYKHfB',
  status:      'fldMd3dPLMmQXtFTX',
  completed:   'fldMdB7bE0KMunBB8',
  notes:       'fldWNtiF9ugA1F4gb',
  lastChecked: 'fldpjDxesZOq37Iqs',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function selectAll(table, opts = {}) {
  const records = [];
  await base(table).select(opts).eachPage((page, next) => {
    records.push(...page);
    next();
  });
  return records;
}

function escSlug(s) { return s.replace(/'/g, "\\'"); }

// ── Data Loaders ──────────────────────────────────────────────────────────────
async function loadHotel() {
  const recs = await selectAll(T_HOTELS, {
    filterByFormula: `{Slug}='${escSlug(SLUG)}'`,
    maxRecords: 1,
  });
  return recs[0] || null;
}

async function loadRoomGuide() {
  return selectAll(T_ROOMS, {
    filterByFormula: `FIND("${escSlug(SLUG)}", ARRAYJOIN({Hotel Slug}))`,
  });
}

async function loadServices() {
  // Try linked field, then direct text field
  let recs = [];
  try {
    recs = await selectAll(T_SERVICES, {
      filterByFormula: `FIND("${escSlug(SLUG)}", ARRAYJOIN({Hotel Slug}))`,
    });
  } catch (_) {}
  if (!recs.length) {
    try {
      recs = await selectAll(T_SERVICES, {
        filterByFormula: `{Hotel Slug}='${escSlug(SLUG)}'`,
      });
    } catch (_) {}
  }
  return recs;
}

async function loadIntents() {
  // AI_INTENT_PATTERNS is a global table (no Hotel Slug field).
  // The server loads all records without slug filtering (server.js line 388).
  // We load all and return the count — any records = patterns available for all tenants.
  return selectAll(T_INTENTS, { maxRecords: 200 });
}

async function loadEvalTests() {
  try {
    // Load all active tests, filter by slug in memory (field name varies)
    const all = await selectAll(T_EVAL, {
      filterByFormula: `{Active}=TRUE()`,
    });
    return all.filter(r => {
      const s = String(r.fields['Hotel Slug'] || r.fields['hotel_slug'] || '').trim();
      return s === SLUG;
    });
  } catch (_) { return []; }
}

async function loadCriticalLintIssues() {
  // AI_CONTENT_LINT uses field IDs — use them in formula to avoid name mismatch.
  // Field IDs: hotelSlug=fldRNukPCdiIjmYlI, severity=fldarZrMNrCVOXrEv, status=fldMu3sLkl3vQ1ptj
  try {
    const all = await selectAll(T_LINT, {
      filterByFormula: `AND({fldRNukPCdiIjmYlI}='${escSlug(SLUG)}', {fldarZrMNrCVOXrEv}='Critical')`,
    });
    return all.filter(r => {
      const status = String(r.fields[F_LINT_STATUS] || r.fields.Status || r.fields.status || '');
      return status === 'New' || status === 'Reviewed';
    });
  } catch (e) {
    // If field IDs don't work, fall back to loading all and filtering
    try {
      const all = await selectAll(T_LINT, {});
      return all.filter(r => {
        const slug     = String(r.fields[F_LINT_SLUG]     || '').trim();
        const severity = String(r.fields[F_LINT_SEVERITY] || '').trim();
        const status   = String(r.fields[F_LINT_STATUS]   || '').trim();
        return slug === SLUG && severity === 'Critical' && (status === 'New' || status === 'Reviewed');
      });
    } catch (_) { return null; } // null signals query failure
  }
}

async function loadOnboardingRows() {
  return selectAll(T_ONBOARD, {
    filterByFormula: `{Tenant Slug}='${escSlug(SLUG)}'`,
  });
}

// ── Check Runner ──────────────────────────────────────────────────────────────
// result: 'PASS' | 'WARN' | 'FAIL'
function check(result, notes) { return { result, notes }; }

function runChecks(hotel, rooms, services, intents, evalTests, criticalLint) {
  const f = hotel?.fields || {};

  // Helper: pick first non-empty across multiple field name variations
  const pf = (...keys) => keys.map(k => f[k]).find(v => v && String(v).trim()) || '';

  const phone = pf('Telefon (recepcija)', 'Telefon recepcija', 'Telefon', 'telefon', 'Phone', 'Phone Number');
  const email = pf('Email (recepcija)', 'E-mail (recepcija)', 'Email', 'email');
  const whatsapp = pf('WhatsApp', 'WhatsApp URL', 'Whatsapp', 'whatsapp');
  const notifEmail = pf('Notification Email', 'notificationEmail');
  const slug = pf('Slug', 'Hotel Slug', 'slug');

  // Per-room quality checks
  const roomsMissingToken   = rooms.filter(r => !String(r.fields['Access Token'] || '').trim());
  const roomsMissingType    = rooms.filter(r => !String(r.fields['Room Type']    || '').trim());
  const roomsMissingWelcome = rooms.filter(r => !String(r.fields['AI WELCOME']   || '').trim());
  // ROOM GUIDE uses "Napomene" in Croatian deployments; also accept "Room Notes" for future tenants
  const roomsMissingNotes   = rooms.filter(r =>
    !String(r.fields['Napomene'] || r.fields['Room Notes'] || r.fields['Notes'] || '').trim()
  );
  const roomNames = rooms.map(r => String(r.fields['Naziv sobe'] || r.id));

  const results = {};

  // Step 1 — HOTELI record exists
  results[1]  = hotel
    ? check('PASS', 'HOTELI record found')
    : check('FAIL', 'No HOTELI record for this slug — create it first');

  // Step 2 — Hotel slug set
  results[2]  = (hotel && slug)
    ? check('PASS', `Slug: ${slug}`)
    : check('FAIL', 'Slug field is empty in HOTELI record');

  // Step 3 — Contact phone set
  results[3]  = phone
    ? check('PASS', `Phone: ${phone}`)
    : check('FAIL', 'Telefon/Phone field is empty in HOTELI — guests cannot reach reception');

  // Step 4 — Contact email set
  results[4]  = email
    ? check('PASS', `Email: ${email}`)
    : check('FAIL', 'Email field is empty in HOTELI');

  // Step 5 — WhatsApp set or intentionally empty
  results[5]  = whatsapp
    ? check('PASS', `WhatsApp: ${whatsapp}`)
    : check('WARN', 'WhatsApp field is empty — WhatsApp handler will fall back to service data or safe-handoff');

  // Step 6 — Notification email set or intentionally empty
  results[6]  = notifEmail
    ? check('PASS', `Notification Email: ${notifEmail}`)
    : check('WARN', 'Notification Email empty — Phase 4 notifications will be skipped (Skipped - No Recipient)');

  // Step 7 — Room Guide records created
  results[7]  = rooms.length > 0
    ? check('PASS', `${rooms.length} Room Guide record(s) found`)
    : check('FAIL', 'No ROOM GUIDE records found — guests cannot authenticate via QR');

  // Step 8 — Access tokens created
  if (!rooms.length) {
    results[8] = check('FAIL', 'Cannot check tokens — no rooms found');
  } else if (roomsMissingToken.length) {
    results[8] = check('FAIL', `${roomsMissingToken.length} room(s) missing Access Token: ${roomsMissingToken.map(r => r.fields['Naziv sobe'] || r.id).join(', ')}`);
  } else {
    results[8] = check('PASS', `All ${rooms.length} rooms have Access Token`);
  }

  // Step 9 — QR links generated (manual — cannot auto-verify)
  results[9]  = check('WARN', 'QR link generation cannot be auto-verified — confirm QR codes printed and tested per room');

  // Step 10 — Room Type populated
  if (!rooms.length) {
    results[10] = check('FAIL', 'Cannot check — no rooms found');
  } else if (roomsMissingType.length) {
    results[10] = check('FAIL', `${roomsMissingType.length} room(s) missing Room Type: ${roomsMissingType.map(r => r.fields['Naziv sobe'] || r.id).join(', ')}`);
  } else {
    results[10] = check('PASS', `All ${rooms.length} rooms have Room Type`);
  }

  // Step 11 — AI WELCOME populated
  if (!rooms.length) {
    results[11] = check('FAIL', 'Cannot check — no rooms found');
  } else if (roomsMissingWelcome.length) {
    results[11] = check('FAIL', `${roomsMissingWelcome.length} room(s) missing AI WELCOME: ${roomsMissingWelcome.map(r => r.fields['Naziv sobe'] || r.id).join(', ')}`);
  } else {
    results[11] = check('PASS', `All ${rooms.length} rooms have AI WELCOME`);
  }

  // Step 12 — Room Notes populated
  if (!rooms.length) {
    results[12] = check('FAIL', 'Cannot check — no rooms found');
  } else if (roomsMissingNotes.length) {
    results[12] = check('WARN', `${roomsMissingNotes.length} room(s) missing Room Notes: ${roomsMissingNotes.map(r => r.fields['Naziv sobe'] || r.id).join(', ')}`);
  } else {
    results[12] = check('PASS', `All ${rooms.length} rooms have Room Notes`);
  }

  // Step 13 — Core services populated
  results[13] = services.length > 0
    ? check('PASS', `${services.length} SERVICES record(s) found`)
    : check('FAIL', 'No SERVICES records found — hotel knowledge base is empty');

  // Step 14 — AI_INTENT_PATTERNS linked
  // This is a global table (no per-hotel filter); all tenants share the pattern set.
  // PASS if any patterns exist globally; WARN if 0 (system would have no deterministic routing).
  results[14] = intents.length > 0
    ? check('PASS', `${intents.length} global AI_INTENT_PATTERNS available (shared across tenants)`)
    : check('FAIL', 'No AI_INTENT_PATTERNS found globally — deterministic routing will not work for any hotel');

  // Step 15 — PWA ask tested (use eval test existence as proxy)
  const pwaTests = evalTests.filter(r => {
    const cat = String(r.fields['Category'] || '').toLowerCase();
    return cat.includes('deterministic') || cat.includes('room');
  });
  results[15] = pwaTests.length > 0
    ? check('PASS', `${pwaTests.length} deterministic/room eval test(s) cover PWA ask endpoint`)
    : check('WARN', 'No deterministic/room eval tests found — manually test /api/pwa-ask with a room token');

  // Step 16 — PWA request tested (manual)
  results[16] = check('WARN', 'PWA request endpoint cannot be auto-tested — manually POST to /api/pwa-request and verify REQUESTS table');

  // Step 17 — Web ask tested (manual)
  results[17] = check('WARN', 'Web ask endpoint cannot be auto-tested — manually POST to /api/ask or check web widget integration');

  // Step 18 — Eval test set created
  results[18] = evalTests.length >= 5
    ? check('PASS', `${evalTests.length} active eval tests found`)
    : evalTests.length > 0
      ? check('WARN', `Only ${evalTests.length} eval test(s) — recommend at least 5 (ideally 30) for coverage`)
      : check('FAIL', 'No eval tests found in AI_EVAL_TESTS — create test set before going live');

  // Step 19 — Lint run completed
  // Check if any lint records exist for this slug (even if all Ignored = lint has been run)
  // We use criticalLint for FAIL check; for this step just see if lint has been run
  results[19] = criticalLint !== null  // null means query failed; array (even empty) means run
    ? check('PASS', criticalLint.length === 0
        ? 'No open Critical lint issues'
        : `${criticalLint.length} open Critical lint issue(s) — see AI_CONTENT_LINT`)
    : check('WARN', 'Could not query AI_CONTENT_LINT — run: npm run lint:content');

  // Step 20 — Notification config checked
  const brevoKeySet = !!(process.env.BREVO_API_KEY);
  if (notifEmail && brevoKeySet) {
    results[20] = check('PASS', 'Notification Email set and BREVO_API_KEY present');
  } else if (!notifEmail && !brevoKeySet) {
    results[20] = check('WARN', 'No Notification Email and no BREVO_API_KEY — notifications are disabled (intentional?)');
  } else if (notifEmail && !brevoKeySet) {
    results[20] = check('WARN', 'Notification Email set but BREVO_API_KEY missing from Render env — emails will not send');
  } else {
    results[20] = check('WARN', 'BREVO_API_KEY set but no Notification Email in HOTELI — emails will be skipped');
  }

  // Step 21 — Privacy/consent flow checked (manual)
  results[21] = check('WARN', 'Privacy/consent flow is a manual check — verify GDPR notice is shown before data collection');

  // Step 22 — Production URLs confirmed (manual)
  results[22] = check('WARN', 'Production URLs are a manual check — confirm /pwa/{slug}/{room}/{token} loads correctly');

  // Step 23 — Client handover checklist completed (manual)
  results[23] = check('WARN', 'Client handover is a manual step — complete and sign off before going live');

  // Override step 19 to FAIL if open Critical issues exist
  if (criticalLint && criticalLint.length > 0) {
    results[19] = check('FAIL', `${criticalLint.length} open Critical lint issue(s) must be resolved before go-live`);
  }

  return results;
}

// ── Update Onboarding Rows ────────────────────────────────────────────────────
async function writeOnboarding(onboardRows, stepResults, ts) {
  const updates = [];
  for (const row of onboardRows) {
    // Fields are keyed by name in Airtable JS SDK read responses
    const step = row.fields['Step'] ?? row.fields[F_OB.step];
    const r = stepResults[step];
    if (!r) continue;

    const completed = r.result === 'PASS';
    const status    = r.result === 'PASS' ? 'Complete'
                    : r.result === 'WARN' ? 'In Progress'
                    : 'Blocked';
    updates.push({
      id: row.id,
      fields: {
        'Completed':    completed,
        'Status':       status,
        'Notes':        r.notes.slice(0, 500),
        'Last Checked': ts,
      },
    });
  }

  // Airtable update limit: 10 per call
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    await base(T_ONBOARD).update(updates.slice(i, i + BATCH));
  }
  return updates.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const ts = new Date().toISOString();
  const bar = '━'.repeat(65);

  console.log(`\n🏨  AI OLLY TENANT VALIDATION`);
  console.log(`    Slug   : ${SLUG}`);
  console.log(`    Run At : ${ts}\n`);

  // ── Load all data in parallel ─────────────────────────────────────────────
  process.stdout.write('  Loading data from Airtable … ');

  async function safe(fn, fallback = []) {
    try { return await fn(); } catch (e) {
      console.warn(`\n  ⚠️  Query error (${fn.name}): ${e.message}`);
      return fallback;
    }
  }

  const [hotel, rooms, services, intents, evalTests, criticalLint, onboardRows] = await Promise.all([
    safe(loadHotel, null),
    safe(loadRoomGuide),
    safe(loadServices),
    safe(loadIntents),
    safe(loadEvalTests),
    safe(loadCriticalLintIssues, null),
    safe(loadOnboardingRows),
  ]);
  console.log('done\n');

  // Hotel context
  const hotelName = hotel?.fields?.['Hotel Name'] || hotel?.fields?.['Naziv'] || hotel?.fields?.Name || SLUG;
  console.log(`  Hotel : ${hotelName}`);
  console.log(`  Rooms : ${rooms.length}`);
  console.log(`  Services : ${services.length}`);
  console.log(`  Intents : ${intents.length}`);
  console.log(`  Eval Tests : ${evalTests.length}`);
  console.log(`  Critical Lint Issues : ${criticalLint?.length ?? 'query failed'}\n`);

  // ── Run checks ────────────────────────────────────────────────────────────
  const stepResults = runChecks(hotel, rooms, services, intents, evalTests, criticalLint);

  // ── Print results ─────────────────────────────────────────────────────────
  const STEP_NAMES = {
    1:  'HOTELI record exists',
    2:  'Hotel slug set',
    3:  'Contact phone set',
    4:  'Contact email set',
    5:  'WhatsApp set or intentionally empty',
    6:  'Notification email set or intentionally empty',
    7:  'Room Guide records created',
    8:  'Access tokens created',
    9:  'QR links generated',
    10: 'Room Type populated',
    11: 'AI WELCOME populated',
    12: 'Room Notes populated',
    13: 'Core services populated',
    14: 'AI_INTENT_PATTERNS linked',
    15: 'PWA ask tested',
    16: 'PWA request tested',
    17: 'Web ask tested',
    18: 'Eval test set created',
    19: 'Lint run completed',
    20: 'Notification config checked',
    21: 'Privacy/consent flow checked',
    22: 'Production URLs confirmed',
    23: 'Client handover checklist completed',
  };

  let passCount = 0, warnCount = 0, failCount = 0;
  const failures = [], warnings = [];

  for (let step = 1; step <= 23; step++) {
    const r = stepResults[step];
    if (!r) continue;
    const icon = r.result === 'PASS' ? '✅' : r.result === 'WARN' ? '⚠️ ' : '❌';
    const name = STEP_NAMES[step] || `Step ${step}`;
    console.log(`  ${icon} [${String(step).padStart(2)}] ${name.padEnd(42)} ${r.result}`);
    if (r.result !== 'PASS') {
      console.log(`         └─ ${r.notes}`);
    }
    if (r.result === 'PASS') passCount++;
    else if (r.result === 'WARN') { warnCount++; warnings.push({ step, name, notes: r.notes }); }
    else { failCount++; failures.push({ step, name, notes: r.notes }); }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${bar}`);
  const overall = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'PASS (with warnings)' : 'PASS';
  console.log(`  ${failCount > 0 ? '❌' : '✅'}  RESULT : ${overall}`);
  console.log(`     PASS: ${passCount}  WARN: ${warnCount}  FAIL: ${failCount}  (of 23 steps)`);
  console.log(bar);

  if (failures.length) {
    console.log('\n  ❌  FAILURES (must fix before go-live):');
    for (const f of failures) {
      console.log(`    [${f.step}] ${f.name}`);
      console.log(`        → ${f.notes}`);
    }
  }

  if (warnings.length) {
    console.log('\n  ⚠️   WARNINGS (review recommended):');
    for (const w of warnings) {
      console.log(`    [${w.step}] ${w.name}`);
      console.log(`        → ${w.notes}`);
    }
  }

  // ── Recommended next actions ──────────────────────────────────────────────
  const recommendations = [];
  if (!hotel) recommendations.push('Create HOTELI record for this slug');
  if (rooms.length === 0) recommendations.push('Add rooms to ROOM GUIDE with Hotel Slug linked to this tenant');
  if (services.length === 0) recommendations.push('Add core SERVICES records (WiFi, Check-in, Breakfast, etc.)');
  if (intents.length === 0) recommendations.push('Add AI_INTENT_PATTERNS records for this hotel');
  if (evalTests.length === 0) recommendations.push('Create eval test set in AI_EVAL_TESTS (minimum 5, recommend 30)');
  if (criticalLint && criticalLint.length > 0) recommendations.push(`Resolve ${criticalLint.length} Critical lint issue(s) in AI_CONTENT_LINT`);
  if (!process.env.BREVO_API_KEY) recommendations.push('Set BREVO_API_KEY in Render env to enable email notifications');

  if (recommendations.length) {
    console.log('\n  📋  RECOMMENDED NEXT ACTIONS:');
    recommendations.forEach((r, i) => console.log(`    ${i + 1}. ${r}`));
  }

  // ── Write back to AI_TENANT_ONBOARDING ───────────────────────────────────
  if (onboardRows.length > 0) {
    process.stdout.write('\n  Writing results to AI_TENANT_ONBOARDING … ');
    try {
      const updated = await writeOnboarding(onboardRows, stepResults, ts);
      console.log(`done (${updated} rows updated)\n`);
    } catch (e) {
      console.error(`\n  ⚠️  Could not write to AI_TENANT_ONBOARDING: ${e.message}\n`);
    }
  } else {
    console.log('\n  ℹ️   No AI_TENANT_ONBOARDING rows found for this slug — run seeder to create them.\n');
  }

  if (failCount > 0) process.exit(1);
}

main().catch(e => { console.error('\n❌  Fatal:', e.message || e); process.exit(1); });

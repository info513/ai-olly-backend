/**
 * AI OLLY — Content Lint Runner
 * Usage: npm run lint:content
 *
 * Reads knowledge records from Airtable (SERVICES, AI_INTENT_PATTERNS,
 * ROOM GUIDE, POI, ROUTES) for the configured hotel slug and writes
 * detected issues to AI_CONTENT_LINT.
 *
 * READ-ONLY on source tables — never modifies content.
 * Deduplicates: will not re-create issues already present with
 * Status = New or Reviewed (matched on Record ID + Issue Type + Field).
 */

import 'dotenv/config';
import Airtable from 'airtable';

// ── Config ────────────────────────────────────────────────────────────────────
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID          = process.env.AIRTABLE_BASE_ID || 'appon9UYjX6KU9cr1';
const SLUG             = 'antique-split';

if (!AIRTABLE_API_KEY) { console.error('❌  AIRTABLE_API_KEY not set'); process.exit(1); }

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(BASE_ID);

// ── Table IDs ─────────────────────────────────────────────────────────────────
const T_SERVICES         = 'tbloZwmqS0vqrCSL9';
const T_INTENT_PATTERNS  = 'tbl6fZUo99dd2Y5kw';
const T_ROOM_GUIDE       = 'tbls3oojfqN8pyYoJ';
const T_POI              = 'tbl5mNNhWjuFMOJva';
const T_ROUTES           = 'tbl1IWdCiWIUqrtkH';
const T_LINT             = 'tblcVy3UaASn7FEHM';

// ── AI_CONTENT_LINT field IDs ─────────────────────────────────────────────────
const F_LINT = {
  recordName:   'fldCPzOF7dIjInUbI',
  timestamp:    'fldzJJJ0D6FEFvf7g',
  hotelSlug:    'fldRNukPCdiIjmYlI',
  table:        'fldaq4jTDOpRZxw7D',
  recordId:     'flda37oudAYskFA7q',
  issueType:    'fldnuMJtBMvzbILUn',
  severity:     'fldarZrMNrCVOXrEv',
  field:        'fldHPw5mEXitECC3J',
  currentValue: 'fldCk1EcyoUtxGFD6',
  suggestedFix: 'fldpZsvo3wt9DPgRa',
  status:       'fldMu3sLkl3vQ1ptj',
  notes:        'fldTXfXTrtqTqqUM7',
};

// ── Expected room-type mapping ─────────────────────────────────────────────────
const EXPECTED_ROOM_TYPES = {
  '101': 'Deluxe Ground Floor',
  '102': 'Deluxe Ground Floor',
  '201': 'Deluxe Room',
  '202': 'Superior Room',
  '203': 'Standard Room',
  '301': 'Deluxe Room',
  '302': 'Superior Room',
  '303': 'Comfort Room',
};

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_AI_SOURCES  = new Set(['WEB', 'PWA', 'BOTH']);
const VALID_APPLIES_TO  = new Set(['WEB', 'PWA', 'BOTH']);
const MAX_OPIS_LEN      = 900;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect Croatian diacritics that should not appear in English-facing text. */
function hasCroatianText(text) {
  return /[čćšžđČĆŠŽĐ]/.test(text || '');
}

/** Check for URLs containing year params that look stale (>1 year old). */
function hasStaleYearInUrl(text) {
  const current = new Date().getFullYear();
  const matches = (text || '').match(/\b(20\d{2})\b/g);
  if (!matches) return false;
  return matches.some(y => parseInt(y) < current - 1);
}

/** Flatten multipleSelects values (may come as objects or strings). */
function selectNames(val) {
  if (!val) return [];
  return (Array.isArray(val) ? val : [val]).map(v =>
    typeof v === 'object' ? (v.name || '') : String(v)
  );
}

/** True if a linked-record field has at least one linked record. */
function hasLink(val) {
  return Array.isArray(val) && val.length > 0;
}

/** True if a lookup field (multipleLookupValues) contains the given slug. */
function slugInLookup(val, slug) {
  const arr = Array.isArray(val) ? val : [];
  return arr.some(v => String(v).toLowerCase() === slug.toLowerCase());
}

// ── Issues collector ──────────────────────────────────────────────────────────
const issues = [];

function addIssue({ recordName, table, recordId, issueType, severity, field,
                    currentValue = '', suggestedFix = '', notes = '' }) {
  issues.push({
    recordName:   String(recordName).slice(0, 255),
    hotelSlug:    SLUG,
    table,
    recordId,
    issueType,
    severity,
    field,
    currentValue: String(currentValue).slice(0, 500),
    suggestedFix: String(suggestedFix).slice(0, 500),
    notes:        String(notes).slice(0, 500),
  });
}

// ── Load all records helper ───────────────────────────────────────────────────
async function loadAll(tableId, opts = {}) {
  const recs = await base(tableId).select(opts).all();
  return recs;
}

// ── SERVICES lint ─────────────────────────────────────────────────────────────
async function lintServices() {
  const recs = await loadAll(T_SERVICES, {
    filterByFormula: `FIND('${SLUG}', ARRAYJOIN({Hotel Slug}, ',')) > 0`,
    fields: [
      'Naziv usluge', 'Opis', 'AI_INTENT', 'AI_SOURCE',
      'Hoteli', 'Active', 'AI_INTENT_PATTERNS',
    ],
  });

  console.log(`  SERVICES: ${recs.length} records`);

  for (const rec of recs) {
    const f    = rec.fields;
    const name = String(f['Naziv usluge'] || rec.id);
    const ctx  = { recordName: name, table: 'SERVICES', recordId: rec.id };

    // Missing hotel link
    if (!hasLink(f['Hoteli'])) {
      addIssue({ ...ctx, issueType: 'missing_hotel_link', severity: 'Critical',
        field: 'Hoteli', currentValue: '(empty)',
        suggestedFix: `Link to hotel record for ${SLUG}` });
    }

    // Missing or empty Opis
    const opis = String(f['Opis'] || '').trim();
    if (!opis) {
      addIssue({ ...ctx, issueType: 'missing_description', severity: 'High',
        field: 'Opis', currentValue: '(empty)',
        suggestedFix: 'Add a clear English description for the AI to use in answers' });
    } else {
      // Overly long
      if (opis.length > MAX_OPIS_LEN) {
        addIssue({ ...ctx, issueType: 'overly_long_description', severity: 'Medium',
          field: 'Opis', currentValue: `${opis.length} chars`,
          suggestedFix: `Trim to under ${MAX_OPIS_LEN} chars to stay within GPT context budget` });
      }
      // Croatian text in English-facing field
      if (hasCroatianText(opis)) {
        addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'High',
          field: 'Opis', currentValue: opis.slice(0, 120),
          suggestedFix: 'Ensure Opis is written in English for English-facing PWA guests' });
      }
      // Stale URL in description
      if (hasStaleYearInUrl(opis)) {
        addIssue({ ...ctx, issueType: 'stale_url', severity: 'High',
          field: 'Opis', currentValue: opis.slice(0, 120),
          suggestedFix: 'Update or remove year-specific URL parameters' });
      }
    }

    // Missing AI_INTENT
    const intents = selectNames(f['AI_INTENT']);
    if (intents.length === 0) {
      addIssue({ ...ctx, issueType: 'missing_intent', severity: 'High',
        field: 'AI_INTENT', currentValue: '(empty)',
        suggestedFix: 'Add at least one AI_INTENT value so the record can be matched by intent routing' });
    }

    // Missing AI_SOURCE
    const sources = selectNames(f['AI_SOURCE']);
    if (sources.length === 0) {
      addIssue({ ...ctx, issueType: 'invalid_ai_source', severity: 'Critical',
        field: 'AI_SOURCE', currentValue: '(empty)',
        suggestedFix: 'Set AI_SOURCE to WEB, PWA, or BOTH' });
    } else {
      // Invalid source value
      const invalid = sources.filter(s => !VALID_AI_SOURCES.has(s));
      if (invalid.length > 0) {
        addIssue({ ...ctx, issueType: 'invalid_ai_source', severity: 'Critical',
          field: 'AI_SOURCE', currentValue: invalid.join(', '),
          suggestedFix: 'Valid values: WEB | PWA | BOTH' });
      }
    }

    // Active = false (inactive but has hotel link — may be intentional)
    if (f['Active'] === false || f['Active'] === null || f['Active'] === undefined) {
      // Only flag if it has an Opis (i.e. it was filled but not activated)
      if (opis) {
        addIssue({ ...ctx, issueType: 'inactive_record', severity: 'Low',
          field: 'Active', currentValue: 'false',
          suggestedFix: 'Set Active = true to include in AI answers, or confirm intentional deactivation' });
      }
    }
  }
}

// ── AI_INTENT_PATTERNS lint ───────────────────────────────────────────────────
async function lintIntentPatterns(serviceMap) {
  // serviceMap: recordId → { name, opis, active, sources }
  const recs = await loadAll(T_INTENT_PATTERNS, {
    fields: ['Intent', 'Phrases', 'Applies to', 'Services link', 'Output Scope'],
  });

  console.log(`  AI_INTENT_PATTERNS: ${recs.length} records`);

  // Track intents for duplicate detection
  const intentCounts = {};

  for (const rec of recs) {
    const f      = rec.fields;
    const intent = String(f['Intent'] || '').trim();
    const name   = intent || rec.id;
    const ctx    = { recordName: name, table: 'AI_INTENT_PATTERNS', recordId: rec.id };

    // Missing Intent
    if (!intent) {
      addIssue({ ...ctx, issueType: 'missing_intent', severity: 'High',
        field: 'Intent', currentValue: '(empty)',
        suggestedFix: 'Provide an intent identifier string' });
      continue;
    }

    // Track for duplicates
    if (!intentCounts[intent]) intentCounts[intent] = [];
    intentCounts[intent].push(rec.id);

    // Missing Phrases
    const phrases = String(f['Phrases'] || '').trim();
    if (!phrases) {
      addIssue({ ...ctx, issueType: 'empty_pattern_phrases', severity: 'Critical',
        field: 'Phrases', currentValue: '(empty)',
        suggestedFix: 'Add newline-separated trigger phrases for this intent' });
    } else {
      const lines = phrases.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        addIssue({ ...ctx, issueType: 'empty_pattern_phrases', severity: 'Critical',
          field: 'Phrases', currentValue: phrases.slice(0, 80),
          suggestedFix: 'Phrases field contains whitespace only — add actual trigger phrases' });
      }
      // Check for Croatian in phrases
      if (hasCroatianText(phrases)) {
        addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'Medium',
          field: 'Phrases', currentValue: phrases.slice(0, 120),
          suggestedFix: 'Ensure trigger phrases are in the language the guest will use (English or Croatian clearly separated)' });
      }
    }

    // Missing / invalid Applies to
    const appliesTo = selectNames(f['Applies to']);
    if (appliesTo.length === 0) {
      addIssue({ ...ctx, issueType: 'invalid_applies_to', severity: 'High',
        field: 'Applies to', currentValue: '(empty)',
        suggestedFix: 'Set Applies to = PWA, WEB, or BOTH' });
    } else {
      const invalid = appliesTo.filter(v => !VALID_APPLIES_TO.has(v));
      if (invalid.length > 0) {
        addIssue({ ...ctx, issueType: 'invalid_applies_to', severity: 'High',
          field: 'Applies to', currentValue: invalid.join(', '),
          suggestedFix: 'Valid values: WEB | PWA | BOTH' });
      }
    }

    // Services link checks
    const linkedServiceIds = (f['Services link'] || []).map(id =>
      typeof id === 'object' ? id.id : String(id)
    );

    if (linkedServiceIds.length === 0) {
      addIssue({ ...ctx, issueType: 'missing_services_link', severity: 'High',
        field: 'Services link', currentValue: '(empty)',
        suggestedFix: 'Link at least one SERVICES record so the pattern can return content' });
    } else {
      for (const svcId of linkedServiceIds) {
        const svc = serviceMap[svcId];
        if (!svc) continue; // service from another hotel — skip

        // Pattern links to inactive service
        if (!svc.active) {
          addIssue({ ...ctx, issueType: 'orphan_pattern', severity: 'High',
            field: 'Services link',
            currentValue: `→ ${svc.name} (inactive)`,
            suggestedFix: `Activate service "${svc.name}" or remove this link` });
        }

        // Pattern links to service with empty Opis
        if (!svc.opis) {
          addIssue({ ...ctx, issueType: 'missing_services_link', severity: 'High',
            field: 'Services link',
            currentValue: `→ ${svc.name} (empty Opis)`,
            suggestedFix: `Add Opis to service "${svc.name}" so it can produce an answer` });
        }
      }
    }
  }

  // Duplicate intents
  for (const [intent, ids] of Object.entries(intentCounts)) {
    if (ids.length > 1) {
      for (const id of ids) {
        addIssue({
          recordName: intent, table: 'AI_INTENT_PATTERNS', recordId: id,
          issueType: 'duplicate_intent', severity: 'Medium',
          field: 'Intent', currentValue: `"${intent}" appears ${ids.length} times`,
          suggestedFix: 'Merge duplicate intent patterns or rename to differentiate',
        });
      }
    }
  }
}

// ── ROOM GUIDE lint ───────────────────────────────────────────────────────────
async function lintRoomGuide() {
  const recs = await loadAll(T_ROOM_GUIDE, {
    filterByFormula: `FIND('${SLUG}', ARRAYJOIN({Hotel Slug}, ',')) > 0`,
    fields: [
      'Naziv sobe', 'Hotel Slug', 'Access Token', 'Room Type',
      'AI WELCOME', 'WiFi', 'Napomene', 'Active', 'Hoteli',
    ],
  });

  console.log(`  ROOM GUIDE: ${recs.length} records`);

  for (const rec of recs) {
    const f    = rec.fields;
    const room = String(f['Naziv sobe'] || rec.id).trim();
    const ctx  = { recordName: `Room ${room}`, table: 'ROOM GUIDE', recordId: rec.id };

    // Missing hotel link
    if (!hasLink(f['Hoteli'])) {
      addIssue({ ...ctx, issueType: 'missing_hotel_link', severity: 'Critical',
        field: 'Hoteli', currentValue: '(empty)',
        suggestedFix: `Link room ${room} to the ${SLUG} hotel record` });
    }

    // Missing Access Token
    const token = String(f['Access Token'] || '').trim();
    if (!token) {
      addIssue({ ...ctx, issueType: 'missing_access_token', severity: 'Critical',
        field: 'Access Token', currentValue: '(empty)',
        suggestedFix: `Generate and set an Access Token for room ${room}` });
    }

    // Missing Room Type
    const roomType = String(f['Room Type'] || '').trim();
    if (!roomType) {
      addIssue({ ...ctx, issueType: 'missing_room_type', severity: 'High',
        field: 'Room Type', currentValue: '(empty)',
        suggestedFix: `Set Room Type for room ${room} (expected: ${EXPECTED_ROOM_TYPES[room] || 'check mapping'})` });
    } else {
      // Check against expected mapping
      const expected = EXPECTED_ROOM_TYPES[room];
      if (expected && roomType.toLowerCase() !== expected.toLowerCase()) {
        addIssue({ ...ctx, issueType: 'inconsistent_room_type', severity: 'High',
          field: 'Room Type',
          currentValue: roomType,
          suggestedFix: `Expected "${expected}" for room ${room} per mapping table` });
      }
    }

    // Missing AI WELCOME
    const welcome = String(f['AI WELCOME'] || '').trim();
    if (!welcome) {
      addIssue({ ...ctx, issueType: 'missing_ai_welcome', severity: 'Medium',
        field: 'AI WELCOME', currentValue: '(empty)',
        suggestedFix: `Add a personalised welcome message for room ${room}` });
    } else if (hasCroatianText(welcome)) {
      addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'High',
        field: 'AI WELCOME', currentValue: welcome.slice(0, 120),
        suggestedFix: 'AI WELCOME is shown to guests — ensure it is in English (or the guest\'s language)' });
    }

    // Missing WiFi
    const wifi = String(f['WiFi'] || '').trim();
    if (!wifi) {
      addIssue({ ...ctx, issueType: 'missing_wifi_data', severity: 'Medium',
        field: 'WiFi', currentValue: '(empty)',
        suggestedFix: `Add WiFi network name and password for room ${room}` });
    }

    // Croatian in Napomene (guest-visible notes)
    const napomene = String(f['Napomene'] || '').trim();
    if (napomene && hasCroatianText(napomene)) {
      addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'Medium',
        field: 'Napomene', currentValue: napomene.slice(0, 120),
        suggestedFix: 'Room notes may be shown to guests — ensure English translation is present' });
    }
  }
}

// ── POI lint ──────────────────────────────────────────────────────────────────
async function lintPOI() {
  const recs = await loadAll(T_POI, {
    filterByFormula: `FIND('${SLUG}', ARRAYJOIN({Hotel Slug}, ',')) > 0`,
    fields: [
      'POI Naziv', 'Kategorije', 'Opis (kratki/hook)', 'Opis (dugi)',
      'Google Maps', 'Aktivno', 'Latitude', 'Longitude', 'Hotel Slug',
    ],
  });

  console.log(`  POI: ${recs.length} records`);

  for (const rec of recs) {
    const f    = rec.fields;
    const name = String(f['POI Naziv'] || rec.id);
    const ctx  = { recordName: name, table: 'POI', recordId: rec.id };
    const active = f['Aktivno'] !== false;

    if (!active) {
      addIssue({ ...ctx, issueType: 'inactive_record', severity: 'Low',
        field: 'Aktivno', currentValue: 'false',
        suggestedFix: 'Set Aktivno = true or confirm this POI should remain hidden' });
    }

    // Missing category
    if (!f['Kategorije']) {
      addIssue({ ...ctx, issueType: 'missing_description', severity: 'Medium',
        field: 'Kategorije', currentValue: '(empty)',
        suggestedFix: 'Assign a category for correct POI filtering in AI answers' });
    }

    // Missing short description
    const opis = String(f['Opis (kratki/hook)'] || '').trim();
    if (!opis) {
      addIssue({ ...ctx, issueType: 'missing_description', severity: active ? 'High' : 'Low',
        field: 'Opis (kratki/hook)', currentValue: '(empty)',
        suggestedFix: 'Add a short hook description for AI answers and guest-facing display' });
    } else {
      if (hasCroatianText(opis)) {
        addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'Medium',
          field: 'Opis (kratki/hook)', currentValue: opis.slice(0, 120),
          suggestedFix: 'Guest-facing POI description should be in English' });
      }
    }

    // Missing Google Maps URL
    if (!f['Google Maps']) {
      addIssue({ ...ctx, issueType: 'missing_maps_url', severity: 'Medium',
        field: 'Google Maps', currentValue: '(empty)',
        suggestedFix: 'Add Google Maps URL so the PWA can show directions' });
    }

    // Missing coordinates (needed for distance calculations)
    const lat = f['Latitude'];
    const lng = f['Longitude'];
    if (!lat || !lng) {
      addIssue({ ...ctx, issueType: 'missing_coordinates', severity: 'Low',
        field: 'Latitude/Longitude', currentValue: `lat=${lat ?? '?'}, lng=${lng ?? '?'}`,
        suggestedFix: 'Add GPS coordinates to enable distance sorting and map display' });
    }
  }
}

// ── ROUTES lint ───────────────────────────────────────────────────────────────
async function lintRoutes() {
  const recs = await loadAll(T_ROUTES, {
    filterByFormula: `FIND('${SLUG}', ARRAYJOIN({Hotel Slug}, ',')) > 0`,
    fields: [
      'Ruta naziv', 'Aktivno', 'Opis rute', 'Tip rute',
      'POI točke', 'Start Lat', 'Start Lng', 'Hotel Slug',
    ],
  });

  console.log(`  ROUTES: ${recs.length} records`);

  for (const rec of recs) {
    const f    = rec.fields;
    const name = String(f['Ruta naziv'] || rec.id);
    const ctx  = { recordName: name, table: 'ROUTES', recordId: rec.id };
    const active = f['Aktivno'] !== false;

    if (!active) {
      addIssue({ ...ctx, issueType: 'inactive_record', severity: 'Low',
        field: 'Aktivno', currentValue: 'false',
        suggestedFix: 'Set Aktivno = true or confirm this route is intentionally inactive' });
    }

    // Missing description
    const opis = String(f['Opis rute'] || '').trim();
    if (!opis) {
      addIssue({ ...ctx, issueType: 'missing_description', severity: active ? 'Medium' : 'Low',
        field: 'Opis rute', currentValue: '(empty)',
        suggestedFix: 'Add a route description for AI answers and guest display' });
    } else if (hasCroatianText(opis)) {
      addIssue({ ...ctx, issueType: 'possible_croatian_text', severity: 'Medium',
        field: 'Opis rute', currentValue: opis.slice(0, 120),
        suggestedFix: 'Route description is guest-facing — ensure English copy is present' });
    }

    // No POI waypoints
    if (!hasLink(f['POI točke'])) {
      addIssue({ ...ctx, issueType: 'orphan_record', severity: active ? 'Medium' : 'Low',
        field: 'POI točke', currentValue: '(no linked POIs)',
        suggestedFix: 'Link at least one POI waypoint to the route' });
    }

    // Missing route type
    if (!f['Tip rute']) {
      addIssue({ ...ctx, issueType: 'missing_description', severity: 'Low',
        field: 'Tip rute', currentValue: '(empty)',
        suggestedFix: 'Set a route type (walking, cycling, etc.)' });
    }

    // Missing start coordinates
    if (!f['Start Lat'] || !f['Start Lng']) {
      addIssue({ ...ctx, issueType: 'missing_coordinates', severity: 'Low',
        field: 'Start Lat/Lng', currentValue: `(${f['Start Lat'] ?? '?'}, ${f['Start Lng'] ?? '?'})`,
        suggestedFix: 'Add start GPS coordinates for map display' });
    }
  }
}

// ── Load existing open lint issues (for dedup) ────────────────────────────────
async function loadExistingOpenIssues() {
  const recs = await loadAll(T_LINT, {
    fields: ['Record ID', 'Issue Type', 'Field', 'Status'],
  });
  // key: "recordId|issueType|field"
  const open = new Set();
  for (const rec of recs) {
    const status = typeof rec.fields['Status'] === 'object'
      ? rec.fields['Status'].name
      : String(rec.fields['Status'] || '');
    if (status === 'New' || status === 'Reviewed' || status === 'Ignored') {
      const key = [
        rec.fields['Record ID'] || '',
        typeof rec.fields['Issue Type'] === 'object' ? rec.fields['Issue Type'].name : String(rec.fields['Issue Type'] || ''),
        rec.fields['Field'] || '',
      ].join('|');
      open.add(key);
    }
  }
  return open;
}

// ── Write issues to Airtable ──────────────────────────────────────────────────
async function writeIssues(open) {
  const ts = new Date().toISOString();
  const toCreate = issues.filter(issue => {
    const key = [issue.recordId, issue.issueType, issue.field].join('|');
    return !open.has(key);
  });

  if (toCreate.length === 0) {
    console.log('\n  No new issues to write (all already open in AI_CONTENT_LINT).');
    return 0;
  }

  const BATCH = 25;
  let written = 0;
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH).map(issue => ({
      fields: {
        [F_LINT.recordName]:   issue.recordName,
        [F_LINT.timestamp]:    ts,
        [F_LINT.hotelSlug]:    issue.hotelSlug,
        [F_LINT.table]:        issue.table,
        [F_LINT.recordId]:     issue.recordId,
        [F_LINT.issueType]:    issue.issueType,
        [F_LINT.severity]:     issue.severity,
        [F_LINT.field]:        issue.field,
        [F_LINT.currentValue]: issue.currentValue,
        [F_LINT.suggestedFix]: issue.suggestedFix,
        [F_LINT.status]:       'New',
        [F_LINT.notes]:        issue.notes,
      },
    }));
    await base(T_LINT).create(batch);
    written += batch.length;
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return written;
}

// ── Load SERVICES into a map for cross-referencing ────────────────────────────
async function loadServiceMap() {
  const recs = await loadAll(T_SERVICES, {
    fields: ['Naziv usluge', 'Opis', 'Active', 'AI_SOURCE'],
  });
  const map = {};
  for (const rec of recs) {
    const sources = selectNames(rec.fields['AI_SOURCE']);
    map[rec.id] = {
      name:   String(rec.fields['Naziv usluge'] || rec.id),
      opis:   String(rec.fields['Opis'] || '').trim(),
      active: rec.fields['Active'] !== false,
      sources,
    };
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍  AI OLLY CONTENT LINT  —  ${new Date().toISOString()}`);
  console.log(`    Hotel slug : ${SLUG}`);
  console.log(`    Base       : ${BASE_ID}\n`);

  // 1. Load service map (all hotels — for pattern cross-ref)
  const serviceMap = await loadServiceMap();

  // 2. Run linters
  console.log('  Linting tables...');
  await lintServices();
  await lintIntentPatterns(serviceMap);
  await lintRoomGuide();
  await lintPOI();
  await lintRoutes();

  // 3. Load existing open issues for dedup
  process.stdout.write('\n  Loading existing open issues … ');
  const open = await loadExistingOpenIssues();
  console.log(`${open.size} open`);

  // 4. Write new issues
  process.stdout.write('  Writing new issues to AI_CONTENT_LINT ');
  const written = await writeIssues(open);

  // 5. Summary
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;

  const bar = '━'.repeat(57);
  console.log(`\n${bar}`);
  console.log(`  TOTAL ISSUES FOUND : ${issues.length}`);
  console.log(`    Critical : ${counts.Critical}`);
  console.log(`    High     : ${counts.High}`);
  console.log(`    Medium   : ${counts.Medium}`);
  console.log(`    Low      : ${counts.Low}`);
  console.log(`  Written to Airtable: ${written} new records`);
  console.log(bar);

  // 6. Top 10
  const sorted = [...issues].sort((a, b) => {
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  console.log('\n  Top issues:');
  for (const issue of sorted.slice(0, 10)) {
    const sev = issue.severity.padEnd(8);
    const tbl = issue.table.padEnd(20);
    console.log(`    [${sev}] ${tbl} ${issue.recordName.slice(0, 35).padEnd(35)} — ${issue.issueType}`);
    if (issue.currentValue && issue.currentValue !== '(empty)') {
      console.log(`              value: ${issue.currentValue.slice(0, 70)}`);
    }
    if (issue.suggestedFix) {
      console.log(`              fix:   ${issue.suggestedFix.slice(0, 70)}`);
    }
  }

  // 7. By table
  const byTable = {};
  for (const i of issues) {
    if (!byTable[i.table]) byTable[i.table] = 0;
    byTable[i.table]++;
  }
  console.log('\n  By table:');
  for (const [t, c] of Object.entries(byTable)) {
    console.log(`    ${t.padEnd(22)} ${c} issue(s)`);
  }
  console.log();
}

main().catch(e => { console.error('\n❌  Fatal:', e.message || e); process.exit(1); });

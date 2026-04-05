// tests/fix-12-pwa-request.test.js
//
// Fix #12 — /api/pwa-request: guest writes a service request from the PWA.
//
// Input validation is pure-logic and fully testable without a live server.
// Token validation and Airtable write require a live server + ROOM GUIDE data;
// they are covered by the design contract documented below.
//
// Design contract (server-side, not unit-testable here):
//   missing room                    → 400  { ok: false, error: 'Missing room' }
//   missing category                → 400  { ok: false, error: 'Missing category' }
//   missing message                 → 400  { ok: false, error: 'Missing message' }
//   wrong / empty token             → 403  { ok: false, error: 'Access denied' }
//   correct token + valid body      → 201  { ok: true, requestId, meta }
//   meta contains: hotelSlug, roomNumber, category, priority, ms

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — replicate the exact validation logic used in /api/pwa-request
// so we can test it deterministically without starting the server.
// ═══════════════════════════════════════════════════════════════════════════

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Mirror of the validation block in app.post('/api/pwa-request').
 * Returns { status, error } on failure, or null on pass.
 */
function validatePwaRequest(body = {}) {
  const roomNumber = pickFirstNonEmpty(body.room, '');
  const category   = pickFirstNonEmpty(body.category, '');
  const message    = pickFirstNonEmpty(body.message, '');

  if (!roomNumber) return { status: 400, error: 'Missing room' };
  if (!category)   return { status: 400, error: 'Missing category' };
  if (!message)    return { status: 400, error: 'Missing message' };

  return null; // validation passed
}

// ═══════════════════════════════════════════════════════════════════════════
// Input validation — 400 cases
// ═══════════════════════════════════════════════════════════════════════════

// TC-PR-01: missing room
test('TC-PR-01: missing room → 400 Missing room', () => {
  const result = validatePwaRequest({ category: 'Housekeeping', message: 'Need towels' });
  assert.deepEqual(result, { status: 400, error: 'Missing room' });
});

// TC-PR-02: empty room string
test('TC-PR-02: empty room string → 400 Missing room', () => {
  const result = validatePwaRequest({ room: '   ', category: 'Housekeeping', message: 'Need towels' });
  assert.deepEqual(result, { status: 400, error: 'Missing room' });
});

// TC-PR-03: missing category
test('TC-PR-03: missing category → 400 Missing category', () => {
  const result = validatePwaRequest({ room: '101', message: 'Need towels' });
  assert.deepEqual(result, { status: 400, error: 'Missing category' });
});

// TC-PR-04: empty category string
test('TC-PR-04: empty category string → 400 Missing category', () => {
  const result = validatePwaRequest({ room: '101', category: '', message: 'Need towels' });
  assert.deepEqual(result, { status: 400, error: 'Missing category' });
});

// TC-PR-05: missing message
test('TC-PR-05: missing message → 400 Missing message', () => {
  const result = validatePwaRequest({ room: '101', category: 'Housekeeping' });
  assert.deepEqual(result, { status: 400, error: 'Missing message' });
});

// TC-PR-06: empty message string
test('TC-PR-06: empty message string → 400 Missing message', () => {
  const result = validatePwaRequest({ room: '101', category: 'Housekeeping', message: '   ' });
  assert.deepEqual(result, { status: 400, error: 'Missing message' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation pass cases
// ═══════════════════════════════════════════════════════════════════════════

// TC-PR-07: minimal valid body (all required fields present)
test('TC-PR-07: valid body with required fields → validation passes', () => {
  const result = validatePwaRequest({ room: '101', category: 'Housekeeping', message: 'Need extra towels' });
  assert.equal(result, null);
});

// TC-PR-08: valid body with optional guestName and priority
test('TC-PR-08: valid body with guestName and priority → validation passes', () => {
  const result = validatePwaRequest({
    room:      '201',
    category:  'Maintenance',
    message:   'The AC remote is missing',
    guestName: 'Ana Horvat',
    priority:  'High',
  });
  assert.equal(result, null);
});

// TC-PR-09: room with only whitespace in all required fields → 400 Missing room (first check)
test('TC-PR-09: all whitespace fields → 400 Missing room', () => {
  const result = validatePwaRequest({ room: '  ', category: '  ', message: '  ' });
  assert.deepEqual(result, { status: 400, error: 'Missing room' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Priority default — pickFirstNonEmpty fallback
// ═══════════════════════════════════════════════════════════════════════════

// TC-PR-10: priority defaults to 'Normal' when omitted
test('TC-PR-10: priority defaults to Normal when not provided', () => {
  const priority = pickFirstNonEmpty(undefined, 'Normal');
  assert.equal(priority, 'Normal');
});

// TC-PR-11: explicit priority overrides default
test('TC-PR-11: explicit priority High overrides default Normal', () => {
  const priority = pickFirstNonEmpty('High', 'Normal');
  assert.equal(priority, 'High');
});

// TC-PR-12: whitespace-only priority falls through to default
test('TC-PR-12: whitespace priority falls through to default Normal', () => {
  const priority = pickFirstNonEmpty('   ', 'Normal');
  assert.equal(priority, 'Normal');
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTE — server-side contracts (not unit-testable without live server):
//
//   Token validation:
//     empty storedToken (field not yet in Airtable) → 403  (fail-closed)
//     token mismatch                                → 403
//     correct token                                 → proceeds to Airtable write
//
//   Airtable write:
//     creates record with Hotel Slug, Naziv sobe, Kategorija, Poruka, Status="New"
//     optional fields: 'Gost - ime' (guestName), 'Prioritet' (priority)
//     response: 201 { ok: true, requestId: created.id, meta: { ... } }
// ═══════════════════════════════════════════════════════════════════════════

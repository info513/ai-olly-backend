// tests/fix-03-filters.test.js
//
// Tests for fail-closed slug and AI_SOURCE filtering (patch introduced after
// airtableSelectAllSafe fallback removal and allowForWeb fail-closed change).
//
// Functions imported from server/filters.js — production implementations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesHotelSlug, allowForWeb, passesLinkedFilter } from '../server/filters.js';

// ─── matchesHotelSlug ─────────────────────────────────────────────────────────

// TC-SLUG-01: correct slug matches
test('TC-SLUG-01: matching slug → true', () => {
  assert.equal(matchesHotelSlug('antique-split', 'antique-split'), true);
});

// TC-SLUG-02: record with wrong slug does not match
test('TC-SLUG-02: different slug → false', () => {
  assert.equal(matchesHotelSlug('other-hotel', 'antique-split'), false);
});

// TC-SLUG-03: record with no slug (null) does not match any hotel
test('TC-SLUG-03: null slug → false (fail-closed)', () => {
  assert.equal(matchesHotelSlug(null, 'antique-split'), false);
});

// TC-SLUG-04: record with empty string slug does not match
test('TC-SLUG-04: empty string slug → false (fail-closed)', () => {
  assert.equal(matchesHotelSlug('', 'antique-split'), false);
});

// TC-SLUG-05: record with undefined slug does not match
test('TC-SLUG-05: undefined slug → false (fail-closed)', () => {
  assert.equal(matchesHotelSlug(undefined, 'antique-split'), false);
});

// TC-SLUG-06: slug in array format (Airtable linked field)
test('TC-SLUG-06: slug as array → matches correctly', () => {
  assert.equal(matchesHotelSlug(['antique-split'], 'antique-split'), true);
});

// TC-SLUG-07: array with wrong slug
test('TC-SLUG-07: array with wrong slug → false', () => {
  assert.equal(matchesHotelSlug(['other-hotel'], 'antique-split'), false);
});

// ─── allowForWeb ──────────────────────────────────────────────────────────────

// TC-SRC-01: empty AI_SOURCE does not pass (fail-closed)
test('TC-SRC-01: empty array AI_SOURCE → false (fail-closed, regression guard)', () => {
  assert.equal(allowForWeb([]), false);
});

// TC-SRC-02: null AI_SOURCE does not pass
test('TC-SRC-02: null AI_SOURCE → false (fail-closed)', () => {
  assert.equal(allowForWeb(null), false);
});

// TC-SRC-03: undefined AI_SOURCE does not pass
test('TC-SRC-03: undefined AI_SOURCE → false (fail-closed)', () => {
  assert.equal(allowForWeb(undefined), false);
});

// TC-SRC-04: PWA does not pass on WEB filter
test('TC-SRC-04: AI_SOURCE=PWA → false', () => {
  assert.equal(allowForWeb(['PWA']), false);
});

// TC-SRC-05: WEB passes
test('TC-SRC-05: AI_SOURCE=WEB → true', () => {
  assert.equal(allowForWeb(['WEB']), true);
});

// TC-SRC-06: BOTH passes (shared records)
test('TC-SRC-06: AI_SOURCE=BOTH → true', () => {
  assert.equal(allowForWeb(['BOTH']), true);
});

// TC-SRC-07: WEB as string (not array) passes
test('TC-SRC-07: AI_SOURCE=WEB as string → true', () => {
  assert.equal(allowForWeb('WEB'), true);
});

// TC-SRC-08: PWA + WEB together → passes (has WEB)
test('TC-SRC-08: AI_SOURCE=[PWA, WEB] → true', () => {
  assert.equal(allowForWeb(['PWA', 'WEB']), true);
});

// ─── passesLinkedFilter ───────────────────────────────────────────────────────
// Mirrors the linked record filter in /api/web-ask:
//   r.active && allowForWeb(r.aiSource) && matchesHotelSlug(r.hotelSlugRaw, hotelSlug)

// TC-LINK-01: linked record without slug does not pass (fail-closed)
test('TC-LINK-01: linked record with no slug → false (fail-closed)', () => {
  const r = { active: true, aiSource: ['WEB'], hotelSlugRaw: null };
  assert.equal(passesLinkedFilter(r, 'antique-split'), false);
});

// TC-LINK-02: linked record with wrong slug does not pass
test('TC-LINK-02: linked record with foreign slug → false', () => {
  const r = { active: true, aiSource: ['WEB'], hotelSlugRaw: 'other-hotel' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), false);
});

// TC-LINK-03: linked record without AI_SOURCE does not pass
test('TC-LINK-03: linked record with no AI_SOURCE → false (fail-closed)', () => {
  const r = { active: true, aiSource: [], hotelSlugRaw: 'antique-split' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), false);
});

// TC-LINK-04: linked record with PWA source does not pass
test('TC-LINK-04: linked record AI_SOURCE=PWA → false', () => {
  const r = { active: true, aiSource: ['PWA'], hotelSlugRaw: 'antique-split' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), false);
});

// TC-LINK-05: inactive record does not pass even with correct slug and source
test('TC-LINK-05: inactive linked record → false', () => {
  const r = { active: false, aiSource: ['WEB'], hotelSlugRaw: 'antique-split' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), false);
});

// TC-LINK-06: valid linked record passes (all three conditions met)
test('TC-LINK-06: valid linked record (WEB + correct slug + active) → true', () => {
  const r = { active: true, aiSource: ['WEB'], hotelSlugRaw: 'antique-split' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), true);
});

// TC-LINK-07: valid linked record with BOTH source passes
test('TC-LINK-07: valid linked record (BOTH + correct slug + active) → true', () => {
  const r = { active: true, aiSource: ['BOTH'], hotelSlugRaw: 'antique-split' };
  assert.equal(passesLinkedFilter(r, 'antique-split'), true);
});

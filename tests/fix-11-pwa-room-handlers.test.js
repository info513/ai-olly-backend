// tests/fix-11-pwa-room-handlers.test.js
//
// Fix #11 — PWA-only deterministic room-guide classifiers:
//   isAcQuestion  (#11a) — air conditioning / climate control
//   isTvQuestion  (#11b) — TV, remote, channels, streaming
//   isSafeQuestion(#11c) — safe-deposit box, valuables
//
// These handlers fire only in /api/pwa-ask. They are never called by
// /api/web-ask, which actively deflects in-room hardware questions to reception.
//
// Token validation is server-side (timingSafeEqual against Airtable field).
// It cannot be unit-tested here without a live server; it is covered by the
// design contract: empty or mismatched token → 403, correct token → proceed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAcQuestion, isTvQuestion, isSafeQuestion } from '../server/classify.js';

// ═══════════════════════════════════════════════════════════════════════════
// isAcQuestion — Fix #11a
// ═══════════════════════════════════════════════════════════════════════════

// ─── Positive cases ───────────────────────────────────────────────────────

// TC-AC-01: bare "AC" question — word-boundary match
test('TC-AC-01: "How do I turn on the AC?" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion('How do I turn on the AC?'), true);
});

// TC-AC-02: "air conditioning" phrase
test('TC-AC-02: "The air conditioning isn\'t working" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion("The air conditioning isn't working"), true);
});

// TC-AC-03: "aircon" no-space spelling
test('TC-AC-03: "How do I adjust the aircon?" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion('How do I adjust the aircon?'), true);
});

// TC-AC-04: Croatian klima (bare stem)
test('TC-AC-04: "Kako radi klima?" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion('Kako radi klima?'), true);
});

// TC-AC-05: Croatian klimatizacija stem
test('TC-AC-05: "Upute za klimatizaciju?" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion('Upute za klimatizaciju?'), true);
});

// TC-AC-06: "air con" with space — different spelling
test('TC-AC-06: "Can I turn off the air con?" triggers isAcQuestion', () => {
  assert.equal(isAcQuestion('Can I turn off the air con?'), true);
});

// ─── Negative cases ───────────────────────────────────────────────────────

// TC-AC-07: "access" contains "ac" as substring — must NOT match (word-boundary)
test('TC-AC-07: "Can I access the internet?" does not trigger isAcQuestion', () => {
  assert.equal(isAcQuestion('Can I access the internet?'), false);
});

// TC-AC-08: "activate" contains "ac" as substring — must NOT match
test('TC-AC-08: "How do I activate the heating?" does not trigger isAcQuestion', () => {
  assert.equal(isAcQuestion('How do I activate the heating?'), false);
});

// TC-AC-09: breakfast question — no AC keywords
test('TC-AC-09: "When is breakfast?" does not trigger isAcQuestion', () => {
  assert.equal(isAcQuestion('When is breakfast?'), false);
});

// TC-AC-10: WiFi question — no AC keywords
test('TC-AC-10: "What is the WiFi password?" does not trigger isAcQuestion', () => {
  assert.equal(isAcQuestion('What is the WiFi password?'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// isTvQuestion — Fix #11b
// ═══════════════════════════════════════════════════════════════════════════

// ─── Positive cases ───────────────────────────────────────────────────────

// TC-TV-01: bare "TV" question — word-boundary match
test('TC-TV-01: "How do I turn on the TV?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('How do I turn on the TV?'), true);
});

// TC-TV-02: remote control
test('TC-TV-02: "Where is the TV remote?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('Where is the TV remote?'), true);
});

// TC-TV-03: channel listing
test('TC-TV-03: "What channels are available?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('What channels are available?'), true);
});

// TC-TV-04: streaming service
test('TC-TV-04: "Can I watch Netflix?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('Can I watch Netflix?'), true);
});

// TC-TV-05: HDMI input
test('TC-TV-05: "Is there an HDMI port?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('Is there an HDMI port?'), true);
});

// TC-TV-06: Croatian televizija stem
test('TC-TV-06: "Kako upaliti televiziju?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('Kako upaliti televiziju?'), true);
});

// TC-TV-07: "television" full word
test('TC-TV-07: "Does the room have a television?" triggers isTvQuestion', () => {
  assert.equal(isTvQuestion('Does the room have a television?'), true);
});

// ─── Negative cases ───────────────────────────────────────────────────────

// TC-TV-08: "aktiv" contains "tv" as substring — must NOT match (word-boundary)
test('TC-TV-08: "How do I aktiv..." does not trigger isTvQuestion via substring', () => {
  assert.equal(isTvQuestion('How do I aktivate the device?'), false);
});

// TC-TV-09: breakfast question — no TV keywords
test('TC-TV-09: "When is breakfast?" does not trigger isTvQuestion', () => {
  assert.equal(isTvQuestion('When is breakfast?'), false);
});

// TC-TV-10: WiFi question — no TV keywords
test('TC-TV-10: "What is the WiFi password?" does not trigger isTvQuestion', () => {
  assert.equal(isTvQuestion('What is the WiFi password?'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// isSafeQuestion — Fix #11c
// ═══════════════════════════════════════════════════════════════════════════

// ─── Positive cases ───────────────────────────────────────────────────────

// TC-SF-01: canonical EN safe question
test('TC-SF-01: "How do I use the safe?" triggers isSafeQuestion', () => {
  assert.equal(isSafeQuestion('How do I use the safe?'), true);
});

// TC-SF-02: valuables storage
test('TC-SF-02: "Where can I store my valuables?" triggers isSafeQuestion', () => {
  assert.equal(isSafeQuestion('Where can I store my valuables?'), true);
});

// TC-SF-03: Croatian sef
test('TC-SF-03: "Gdje je sef?" triggers isSafeQuestion', () => {
  assert.equal(isSafeQuestion('Gdje je sef?'), true);
});

// TC-SF-04: "safe box" phrasing
test('TC-SF-04: "How do I lock the safe box?" triggers isSafeQuestion', () => {
  assert.equal(isSafeQuestion('How do I lock the safe box?'), true);
});

// ─── Negative cases ───────────────────────────────────────────────────────

// TC-SF-05: breakfast question — no safe keywords
test('TC-SF-05: "When is breakfast?" does not trigger isSafeQuestion', () => {
  assert.equal(isSafeQuestion('When is breakfast?'), false);
});

// TC-SF-06: parking question — no safe keywords
test('TC-SF-06: "Is there parking?" does not trigger isSafeQuestion', () => {
  assert.equal(isSafeQuestion('Is there parking?'), false);
});

// NOTE — known tradeoff (v1):
// "Is it safe to walk outside at night?" returns TRUE from isSafeQuestion.
// This is accepted: in an in-room PWA context this question is rare, and
// returning safe-box instructions is preferable to GPT hallucination.
// A secondary signal ('walk', 'outside', 'area') could guard this in v2.

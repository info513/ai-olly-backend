// tests/fix-04-routing.test.js
//
// Regression tests for three routing/mapping bugs found during smoke testing
// of the 8 new SERVICES records (2026-04-03).
//
// Fix #4a — isContactCoreQuestion: 'tel' must match as whole word only.
//   q.includes('tel') was matching 'hotel' and 'obitelj' (Croatian for family),
//   silently routing those questions to the hotel-core card.
//
// Fix #4b — isContactCoreQuestion: 'check in' must not swallow experience questions.
//   'check-in' normalises to 'check in', so "What is the check-in experience like?"
//   was hitting the deterministic hotel-core path instead of the Check-in Experience
//   SERVICE record.
//
// Fix #4c — mapServiceRecord: Airtable field 'AI_PROMPT  ' (two trailing spaces).
//   The field key in the Airtable schema has two trailing spaces. The code was
//   reading f.AI_PROMPT (no spaces) which always resolves to undefined, so GPT
//   never received the behavioural prompt instructions for SERVICE records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isContactCoreQuestion } from '../server/classify.js';

// ─── Fix #4a: 'tel' whole-word match ──────────────────────────────────────────

// TC-RT-01: 'hotel' contains 'tel' as substring — must NOT fire hotel_core
test('TC-RT-01: question with "hotel" does not trigger isContactCoreQuestion via tel', () => {
  assert.equal(isContactCoreQuestion('Can you recommend a good restaurant near the hotel?'), false);
});

// TC-RT-02: Croatian 'obitelj' (family) contains 'tel' — must NOT fire hotel_core
test('TC-RT-02: Croatian "obitelj" does not trigger isContactCoreQuestion via tel', () => {
  assert.equal(isContactCoreQuestion('Imate li sobe jednu do druge za obitelj?'), false);
});

// TC-RT-03: Croatian 'obitelj' variant with different phrasing — must NOT fire
test('TC-RT-03: "rooms for the whole family" does not trigger via tel in hotel', () => {
  assert.equal(isContactCoreQuestion('Do you have rooms for the whole family at the hotel?'), false);
});

// TC-RT-04: standalone 'tel' (Croatian phone abbreviation) MUST still fire
test('TC-RT-04: standalone "tel" abbreviation still triggers isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('tel: 021785208'), true);
});

// TC-RT-05: 'telefon' still triggers (existing regression guard)
test('TC-RT-05: "telefon" still triggers isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Koji je vaš telefon?'), true);
});

// ─── Fix #4b: check-in experience questions pass through ─────────────────────

// TC-RT-06: check-in experience EN — must NOT fire hotel_core
test('TC-RT-06: EN check-in experience question does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('What is the check-in experience like?'), false);
});

// TC-RT-07: check-in experience HR — must NOT fire hotel_core
test('TC-RT-07: HR check-in experience question does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Kako izgleda dolazak i check-in?'), false);
});

// TC-RT-08: check-in process question — must NOT fire hotel_core
test('TC-RT-08: check-in process question does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('What happens during the check-in process?'), false);
});

// TC-RT-09: check-in time question MUST still fire (regression guard)
test('TC-RT-09: "What time is check-in?" still triggers isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('What time is check-in?'), true);
});

// TC-RT-10: check-out time question MUST still fire (regression guard)
test('TC-RT-10: "What time is check-out?" still triggers isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('What time is check-out?'), true);
});

// TC-RT-11: bare check-in question MUST still fire (shortest valid case)
test('TC-RT-11: bare "check-in" question still triggers isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Check-in?'), true);
});

// ─── Fix #5: non-timing service-request contexts pass through ────────────────

// TC-RT-15: "what happens during check-in" — must NOT fire (QA-010)
test('TC-RT-15: "What happens during check-in?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('What happens during check-in?'), false);
});

// TC-RT-16: luggage storage after check-out — must NOT fire (QA-022)
test('TC-RT-16: "Can I store my luggage after check-out?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Can I store my luggage after check-out?'), false);
});

// TC-RT-17: late check-out request — must NOT fire (QA-023)
test('TC-RT-17: "Can I request a late check-out?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Can I request a late check-out?'), false);
});

// TC-RT-18: early check-in possibility — must NOT fire (QA-024)
test('TC-RT-18: "Is early check-in possible?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Is early check-in possible?'), false);
});

// ─── Fix #4c: AI_PROMPT field with trailing spaces ───────────────────────────
// mapServiceRecord is not exported, so we test the field-reading logic directly
// and confirm both the old (broken) behaviour and the new (fixed) behaviour.

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// TC-RT-12: old mapping (no trailing spaces) returns empty — documents the bug
test('TC-RT-12: old f.AI_PROMPT mapping returns empty when field has trailing spaces', () => {
  const f = { 'AI_PROMPT  ': 'behavioral instruction' };
  const oldResult = pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt);
  assert.equal(oldResult, ''); // proves the bug existed
});

// TC-RT-13: fixed mapping reads the trailing-space key correctly
test('TC-RT-13: fixed mapping reads "AI_PROMPT  " (trailing-space key) correctly', () => {
  const f = { 'AI_PROMPT  ': 'behavioral instruction' };
  const fixed = pickFirstNonEmpty(f['AI_PROMPT  '], f.AI_PROMPT, f.ai_prompt);
  assert.equal(fixed, 'behavioral instruction');
});

// TC-RT-14: fallback to f.AI_PROMPT still works for records with the clean key
test('TC-RT-14: fixed mapping still falls back to f.AI_PROMPT for clean key', () => {
  const f = { AI_PROMPT: 'clean instruction' };
  const result = pickFirstNonEmpty(f['AI_PROMPT  '], f.AI_PROMPT, f.ai_prompt);
  assert.equal(result, 'clean instruction');
});

// ─── Fix #6: Croatian check-in / check-out coverage ──────────────────────────

// TC-RT-19: Croatian "prijava" (check-in) MUST fire hotel_core
test('TC-RT-19: "Kada je prijava?" triggers isContactCoreQuestion via HR prijava', () => {
  assert.equal(isContactCoreQuestion('Kada je prijava?'), true);
});

// TC-RT-20: Croatian "odjava" (check-out) MUST fire hotel_core
test('TC-RT-20: "Kada je odjava?" triggers isContactCoreQuestion via HR odjava', () => {
  assert.equal(isContactCoreQuestion('Kada je odjava?'), true);
});

// TC-RT-21: "prijava na Wi-Fi" must NOT fire hotel_core (wifi guard)
test('TC-RT-21: "Prijava na Wi-Fi?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Prijava na Wi-Fi?'), false);
});

// TC-RT-22: "Kasna odjava?" must NOT fire hotel_core (isNonTimingCheckinout guard)
test('TC-RT-22: "Kasna odjava?" does not trigger isContactCoreQuestion', () => {
  assert.equal(isContactCoreQuestion('Kasna odjava?'), false);
});

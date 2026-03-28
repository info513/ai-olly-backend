// tests/fix-01-02.test.js
//
// Tests for:
//   Fix #1 — detectLang: "parking" removed from HR word list (server.js line 183)
//   Fix #2 — HARD STOP: removed && !hotelRec so it fires when recordsToUse is empty (server.js line 1563)
//
// Functions are imported from server/classify.js — the real production implementations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, isContactCoreQuestion, isHotelSpecificQuestion, isCityQuestion } from '../server/classify.js';

// Fix #2 applied: hard stop condition from server.js line ~1563, without && !hotelRec
function hardStopShouldFire(question, recordsToUse = []) {
  return isHotelSpecificQuestion(question) && recordsToUse.length === 0 && !isCityQuestion(question);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// TC-01: EN "parking" question — Fix #1 regression
// Before Fix #1: "parking" was in hasHrWords → detectLang returned HR (wrong)
// After Fix #1:  no HR indicators → EN
test('TC-01: EN parking question → lang=EN, hard stop fires', () => {
  const q = 'Is there parking available near the hotel?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-02: HR parking question via "gdje" token
// detectLang still returns HR because "gdje" remains in the HR word list
test('TC-02: HR parking question (gdje) → lang=HR, hard stop fires', () => {
  const q = 'Gdje je parking?';
  assert.equal(detectLang(q), 'HR');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-03: EN breakfast question — Fix #2 regression
// Before Fix #2: hotelRec exists → !hotelRec=false → hard stop never fired → GPT hallucinated
// After Fix #2:  no records → hard stop fires
test('TC-03: EN breakfast question → lang=EN, hard stop fires', () => {
  const q = 'What time does breakfast start?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-04: HR doručak — detected via diacritic (č), not via "parking" keyword
test('TC-04: HR doručak question (dijakritica) → lang=HR, hard stop fires', () => {
  const q = 'Kada počinje doručak?';
  assert.equal(detectLang(q), 'HR');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-05: EN WiFi question
test('TC-05: EN WiFi question → lang=EN, hard stop fires', () => {
  const q = 'Do you have free WiFi?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-06: EN check-in time — caught by isContactCoreQuestion BEFORE hard stop in route handler
// Route handler returns early at the isContactCoreQuestion check → hard stop code never reached
// We verify isContactCoreQuestion=true, not hardStopShouldFire
test('TC-06: EN check-in time → caught by isContactCoreQuestion before hard stop', () => {
  const q = 'What is the check-in time?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(isContactCoreQuestion(q), true); // route returns early here
});

// TC-07: City question — hard stop has !isCityQuestion() guard, so it does NOT fire
test('TC-07: EN Split/Palace city question → hard stop does NOT fire (city exception)', () => {
  const q = "Tell me about Diocletian's Palace in Split";
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), false);
});

// TC-08: Short EN "Free parking?" — edge case for Fix #1
// Single-word parking question with no other context
test('TC-08: EN "Free parking?" (short) → lang=EN, hard stop fires', () => {
  const q = 'Free parking?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-09: HR "Ima li wifi lozinka?" — detected via "li" token, not diacritics
// Verifies that removing "parking" did not break detection of other HR tokens
test('TC-09: HR "Ima li wifi lozinka?" → lang=HR via "li" token, hard stop fires', () => {
  const q = 'Ima li wifi lozinka?';
  assert.equal(detectLang(q), 'HR');
  assert.equal(hardStopShouldFire(q, []), true);
});

// TC-10: EN "Parking price?" — minimal two-word question, both fixes active
// Fix #1: "parking" no longer triggers HR
// Fix #2: no records → hard stop fires (before Fix #2, GPT would hallucinate a price)
test('TC-10: EN "Parking price?" (edge case) → lang=EN, hard stop fires', () => {
  const q = 'Parking price?';
  assert.equal(detectLang(q), 'EN');
  assert.equal(hardStopShouldFire(q, []), true);
});

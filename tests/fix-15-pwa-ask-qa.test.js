// tests/fix-15-pwa-ask-qa.test.js
//
// Fix #15 — GPT QA pass for /api/pwa-ask
//
// Unit tests for two new classifiers added during QA:
//   isCityActivityQuestion   — sightseeing/attraction/excursion detection
//   isCheckinTimeOnlyQuestion — concise check-in/out timing handler

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { isCityActivityQuestion, isCheckinTimeOnlyQuestion } from '../server/classify.js';

// ═══════════════════════════════════════════════════════════════════════════
// isCityActivityQuestion — TC-CA-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-CA-01: "what to see nearby" → true
test('TC-CA-01: EN what to see → city activity', () => {
  assert.ok(isCityActivityQuestion('Can you suggest what to see nearby?'));
});

// TC-CA-02: "sightseeing" keyword → true
test('TC-CA-02: EN sightseeing → city activity', () => {
  assert.ok(isCityActivityQuestion('Are there any sightseeing options?'));
});

// TC-CA-03: "attractions" keyword → true
test('TC-CA-03: EN attractions → city activity', () => {
  assert.ok(isCityActivityQuestion('What are the local attractions?'));
});

// TC-CA-04: HR "što vrijedi vidjeti u Splitu" → true
test('TC-CA-04: HR vidjeti + split → city activity', () => {
  assert.ok(isCityActivityQuestion('Što vrijedi vidjeti u Splitu?'));
});

// TC-CA-05: HR "što mogu posjetiti u blizini" → true
test('TC-CA-05: HR posjetiti + blizini → city activity', () => {
  assert.ok(isCityActivityQuestion('Što mogu posjetiti u blizini hotela?'));
});

// TC-CA-06: HR "znamenitosti" → true
test('TC-CA-06: HR znamenitosti → city activity', () => {
  assert.ok(isCityActivityQuestion('Koje su znamenitosti u blizini?'));
});

// TC-CA-07: HR "izlet" → true
test('TC-CA-07: HR izlet → city activity', () => {
  assert.ok(isCityActivityQuestion('Možete li preporučiti kakav izlet?'));
});

// TC-CA-08: "landmark" → true
test('TC-CA-08: EN landmark → city activity', () => {
  assert.ok(isCityActivityQuestion('What landmarks are near the hotel?'));
});

// TC-CA-09: "excursion" → true
test('TC-CA-09: EN excursion → city activity', () => {
  assert.ok(isCityActivityQuestion('Is there a boat excursion available?'));
});

// TC-CA-10: Restaurant question → false (should not match)
test('TC-CA-10: restaurant question → NOT city activity', () => {
  assert.ok(!isCityActivityQuestion('Can you recommend a restaurant?'));
});

// TC-CA-11: Breakfast question → false
test('TC-CA-11: breakfast question → NOT city activity', () => {
  assert.ok(!isCityActivityQuestion('Kada je doručak?'));
});

// TC-CA-12: WiFi question → false
test('TC-CA-12: wifi question → NOT city activity', () => {
  assert.ok(!isCityActivityQuestion('What is the WiFi password?'));
});

// TC-CA-13: Room question → false
test('TC-CA-13: room question → NOT city activity', () => {
  assert.ok(!isCityActivityQuestion('How do I use the AC?'));
});

// TC-CA-14: Parking nearby → false ("nearby" alone not enough without sightseeing word)
test('TC-CA-14: parking nearby → NOT city activity', () => {
  assert.ok(!isCityActivityQuestion('Is there parking nearby?'));
});

// ═══════════════════════════════════════════════════════════════════════════
// isCheckinTimeOnlyQuestion — TC-CT-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-CT-01: "What time is check-in?" → true
test('TC-CT-01: EN what time is check-in → checkin time', () => {
  assert.ok(isCheckinTimeOnlyQuestion('What time is check-in?'));
});

// TC-CT-02: "When is check-out?" → true
test('TC-CT-02: EN when is check-out → checkin time', () => {
  assert.ok(isCheckinTimeOnlyQuestion('When is check-out?'));
});

// TC-CT-03: HR "Kada je prijava?" → true
test('TC-CT-03: HR kada je prijava → checkin time', () => {
  assert.ok(isCheckinTimeOnlyQuestion('Kada je prijava?'));
});

// TC-CT-04: HR "U koliko sati je odjava?" → true
test('TC-CT-04: HR u koliko sati je odjava → checkin time', () => {
  assert.ok(isCheckinTimeOnlyQuestion('U koliko sati je odjava?'));
});

// TC-CT-05: "early check-in" → false (non-timing: service request)
test('TC-CT-05: early check-in → NOT checkin time only', () => {
  assert.ok(!isCheckinTimeOnlyQuestion('Is early check-in possible?'));
});

// TC-CT-06: "late check-out" → false
test('TC-CT-06: late check-out → NOT checkin time only', () => {
  assert.ok(!isCheckinTimeOnlyQuestion('Can I request a late check-out?'));
});

// TC-CT-07: WiFi login "prijava" → false (prijava + wifi guard)
test('TC-CT-07: WiFi prijava → NOT checkin time only', () => {
  assert.ok(!isCheckinTimeOnlyQuestion('Kako napraviti prijavu na wifi?'));
});

// TC-CT-08: "What is check-in like?" → false (no time signal)
test('TC-CT-08: what is check-in like → NOT checkin time only (no time signal)', () => {
  assert.ok(!isCheckinTimeOnlyQuestion('What is check-in like?'));
});

// TC-CT-09: "luggage after check-out" → false (non-timing)
test('TC-CT-09: luggage after check-out → NOT checkin time only', () => {
  assert.ok(!isCheckinTimeOnlyQuestion('Can I store luggage after check-out?'));
});

// TC-CT-10: "check-in time" bare → true
test('TC-CT-10: EN check-in time → checkin time', () => {
  assert.ok(isCheckinTimeOnlyQuestion('What is the check-in time?'));
});

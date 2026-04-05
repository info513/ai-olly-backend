// tests/fix-07-breakfast-hours.test.js
//
// Fix #7 — isBreakfastHoursQuestion: deterministic handler for breakfast
// operating hours questions.
//
// The classifier fires only when BOTH a breakfast keyword AND a time/schedule
// signal are present. Menu, availability, and content questions must pass
// through to GPT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBreakfastHoursQuestion } from '../server/classify.js';

// ─── Positive cases: must fire (deterministic path) ──────────────────────────

// TC-BH-01: canonical EN hours question
test('TC-BH-01: "When is breakfast?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('When is breakfast?'), true);
});

// TC-BH-02: Croatian hours question with diacritic
test('TC-BH-02: "Kada je doručak?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Kada je doručak?'), true);
});

// TC-BH-03: Croatian "how long" question
test('TC-BH-03: "Koliko traje doručak?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Koliko traje doručak?'), true);
});

// TC-BH-04: EN time + end signal
test('TC-BH-04: "What time does breakfast end?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('What time does breakfast end?'), true);
});

// TC-BH-05: EN "hours" as a noun
test('TC-BH-05: "Breakfast hours?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Breakfast hours?'), true);
});

// TC-BH-06: Croatian no-diacritic variant ("dorucak")
test('TC-BH-06: "Kada je dorucak?" triggers isBreakfastHoursQuestion (no-diacritic)', () => {
  assert.equal(isBreakfastHoursQuestion('Kada je dorucak?'), true);
});

// TC-BH-07: EN "when does breakfast start"
test('TC-BH-07: "When does breakfast start?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('When does breakfast start?'), true);
});

// TC-BH-08: Croatian radno vrijeme phrasing
test('TC-BH-08: "Radno vrijeme doručka?" triggers isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Radno vrijeme doručka?'), true);
});

// ─── Negative cases: must NOT fire (fall through to GPT) ─────────────────────

// TC-BH-09: menu/content question — no time signal
test('TC-BH-09: "What is served for breakfast?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('What is served for breakfast?'), false);
});

// TC-BH-10: availability question — no time signal
test('TC-BH-10: "Do you offer breakfast?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Do you offer breakfast?'), false);
});

// TC-BH-11: inclusion question — no time signal
test('TC-BH-11: "Is breakfast included?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Is breakfast included?'), false);
});

// TC-BH-12: content question — no time signal
test('TC-BH-12: "What does breakfast include?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('What does breakfast include?'), false);
});

// TC-BH-13: time signal present but no breakfast keyword — must not fire
test('TC-BH-13: "What time is check-in?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('What time is check-in?'), false);
});

// TC-BH-14: ordering question — no time signal
test('TC-BH-14: "Can I order eggs for breakfast?" does not trigger isBreakfastHoursQuestion', () => {
  assert.equal(isBreakfastHoursQuestion('Can I order eggs for breakfast?'), false);
});

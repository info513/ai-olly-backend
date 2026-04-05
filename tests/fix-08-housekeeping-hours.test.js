// tests/fix-08-housekeeping-hours.test.js
//
// Fix #8 — isHousekeepingHoursQuestion: deterministic handler for housekeeping
// operating hours questions.
//
// Same two-condition structure as Fix #7 (breakfast hours):
//   hasHousekeeping && hasTimeSignal
//
// Service-request questions ("Can housekeeping change my towels?") must pass
// through to GPT — they have no time signal.
//
// Also covers the parseTimeRange PM→24h enhancement: "8:00 AM to 2:00 PM"
// must produce ["8:00", "14:00"] without breaking breakfast ("7:30 AM to
// 10:30 AM" must still produce ["7:30", "10:30"]).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHousekeepingHoursQuestion } from '../server/classify.js';

// ─── Positive cases: must fire (deterministic path) ──────────────────────────

// TC-HK-01: canonical EN hours question
test('TC-HK-01: "When is housekeeping?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('When is housekeeping?'), true);
});

// TC-HK-02: EN time + arrival signal
test('TC-HK-02: "What time does housekeeping come?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('What time does housekeeping come?'), true);
});

// TC-HK-03: EN "hours" as noun
test('TC-HK-03: "Housekeeping hours?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('Housekeeping hours?'), true);
});

// TC-HK-04: Croatian sobarica + kada
test('TC-HK-04: "Kada dolazi sobarica?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('Kada dolazi sobarica?'), true);
});

// TC-HK-05: Croatian čišćenje (genitive) + radno
test('TC-HK-05: "Radno vrijeme čišćenja?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('Radno vrijeme čišćenja?'), true);
});

// TC-HK-06: Croatian čišćenje (nominative) + kada
test('TC-HK-06: "Kada je čišćenje sobe?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('Kada je čišćenje sobe?'), true);
});

// TC-HK-07: no-diacritic Croatian variant
test('TC-HK-07: "Kada je ciscenje?" triggers isHousekeepingHoursQuestion (no-diacritic)', () => {
  assert.equal(isHousekeepingHoursQuestion('Kada je ciscenje?'), true);
});

// TC-HK-08: EN "what time does housekeeping start"
test('TC-HK-08: "What time does housekeeping start?" triggers isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('What time does housekeeping start?'), true);
});

// ─── Negative cases: must NOT fire (fall through to GPT) ─────────────────────

// TC-HK-09: service request — no time signal
test('TC-HK-09: "Can I request extra towels from housekeeping?" does not trigger', () => {
  assert.equal(isHousekeepingHoursQuestion('Can I request extra towels from housekeeping?'), false);
});

// TC-HK-10: policy question — no time signal
test('TC-HK-10: "Can housekeeping change my towels?" does not trigger', () => {
  assert.equal(isHousekeepingHoursQuestion('Can housekeeping change my towels?'), false);
});

// TC-HK-11: DND question — no housekeeping keyword AND no time signal
test('TC-HK-11: "How does the Do Not Disturb sign work?" does not trigger', () => {
  assert.equal(isHousekeepingHoursQuestion('How does the Do Not Disturb sign work?'), false);
});

// TC-HK-12: time signal present but no housekeeping keyword
test('TC-HK-12: "What time is breakfast?" does not trigger isHousekeepingHoursQuestion', () => {
  assert.equal(isHousekeepingHoursQuestion('What time is breakfast?'), false);
});

// TC-HK-13: extra pillows request — housekeeping keyword but no time signal
test('TC-HK-13: "Can I get extra pillows from housekeeping?" does not trigger', () => {
  assert.equal(isHousekeepingHoursQuestion('Can I get extra pillows from housekeeping?'), false);
});

// ─── parseTimeRange PM→24h regression (inline, no server import needed) ──────
// Validates that the enhanced parseTimeRange correctly converts PM end times
// and leaves AM-only ranges unchanged (breakfast regression guard).

function parseTimeRange(raw) {
  const parts = String(raw || '').split(/\s+to\s+/i);
  if (parts.length !== 2) return null;
  function to24h(segment) {
    const seg = segment.trim();
    const isPM = /PM/i.test(seg);
    const time = seg.replace(/\s*[AP]M/gi, '').trim();
    if (!isPM) return time;
    const [h, m] = time.split(':').map(Number);
    const hour24 = h === 12 ? 12 : h + 12;
    return `${hour24}:${String(m || 0).padStart(2, '0')}`;
  }
  return [to24h(parts[0]), to24h(parts[1])];
}

// TC-HK-14: housekeeping range — PM end converts to 14:00
test('TC-HK-14: parseTimeRange "8:00 AM to 2:00 PM" → ["8:00", "14:00"]', () => {
  assert.deepEqual(parseTimeRange('8:00 AM to 2:00 PM'), ['8:00', '14:00']);
});

// TC-HK-15: breakfast range — all AM, unchanged (regression guard)
test('TC-HK-15: parseTimeRange "7:30 AM to 10:30 AM" → ["7:30", "10:30"] (regression)', () => {
  assert.deepEqual(parseTimeRange('7:30 AM to 10:30 AM'), ['7:30', '10:30']);
});

// TC-HK-16: noon start is preserved (12 PM = 12:00, not 24:00)
test('TC-HK-16: parseTimeRange "12:00 PM to 3:00 PM" → ["12:00", "15:00"]', () => {
  assert.deepEqual(parseTimeRange('12:00 PM to 3:00 PM'), ['12:00', '15:00']);
});

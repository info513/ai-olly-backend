// tests/fix-09-wifi.test.js
//
// Fix #9 — isWifiQuestion: deterministic handler for WiFi / connectivity
// questions. The Complimentary WiFi record Opis (network name + password) is
// returned verbatim for any matching question.
//
// No secondary signal required — any WiFi keyword = credentials question.
// 'internet' intentionally omitted (too broad; would catch "internet corner").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWifiQuestion } from '../server/classify.js';

// ─── Positive cases: must fire (deterministic path) ──────────────────────────

// TC-WF-01: canonical EN password question
test('TC-WF-01: "What is the WiFi password?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('What is the WiFi password?'), true);
});

// TC-WF-02: network name question
test('TC-WF-02: "What is the WiFi network name?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('What is the WiFi network name?'), true);
});

// TC-WF-03: bare "WiFi?" question
test('TC-WF-03: "WiFi?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('WiFi?'), true);
});

// TC-WF-04: EN connect question
test('TC-WF-04: "How do I connect to the internet?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('How do I connect to the internet?'), true);
});

// TC-WF-05: Croatian lozinka (with diacritic)
test('TC-WF-05: "Koja je lozinka za Wi-Fi?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('Koja je lozinka za Wi-Fi?'), true);
});

// TC-WF-06: Croatian mreža (no-diacritic)
test('TC-WF-06: "Koji je naziv mreze?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('Koji je naziv mreze?'), true);
});

// TC-WF-07: EN "wi fi" spaced variant
test('TC-WF-07: "How do I access the wi fi?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('How do I access the wi fi?'), true);
});

// TC-WF-08: EN network question without "WiFi" keyword
test('TC-WF-08: "What is the network name?" triggers isWifiQuestion', () => {
  assert.equal(isWifiQuestion('What is the network name?'), true);
});

// ─── Negative cases: must NOT fire (fall through to GPT) ─────────────────────

// TC-WF-09: internet corner amenity — 'internet' intentionally omitted
test('TC-WF-09: "Is there an internet corner?" does not trigger isWifiQuestion', () => {
  assert.equal(isWifiQuestion('Is there an internet corner?'), false);
});

// TC-WF-10: breakfast question — no WiFi keyword
test('TC-WF-10: "When is breakfast?" does not trigger isWifiQuestion', () => {
  assert.equal(isWifiQuestion('When is breakfast?'), false);
});

// TC-WF-11: hotel contact question
test('TC-WF-11: "What is the hotel phone number?" does not trigger isWifiQuestion', () => {
  assert.equal(isWifiQuestion('What is the hotel phone number?'), false);
});

// TC-WF-12: parking question — no WiFi keyword
test('TC-WF-12: "Is there parking nearby?" does not trigger isWifiQuestion', () => {
  assert.equal(isWifiQuestion('Is there parking nearby?'), false);
});

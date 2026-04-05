// tests/fix-10-pet-policy.test.js
//
// Fix #10 — isPetPolicyQuestion: deterministic handler for pet policy
// questions. The Pet Policy (No Pets) record Opis is returned verbatim.
//
// No secondary signal required — any pet keyword = policy question.
// 'cat' omitted (substring of 'catalog', 'category').
// 'pas' omitted (substring of 'pasta', 'pass', 'passenger').
// 'ljubim' stem covers: ljubimac, ljubimci, ljubimca, ljubimcu, etc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPetPolicyQuestion } from '../server/classify.js';

// ─── Positive cases: must fire (deterministic path) ──────────────────────────

// TC-PT-01: canonical EN pets question
test('TC-PT-01: "Are pets allowed?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Are pets allowed?'), true);
});

// TC-PT-02: EN dog question
test('TC-PT-02: "Can I bring my dog?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Can I bring my dog?'), true);
});

// TC-PT-03: EN pet-friendly question
test('TC-PT-03: "Is the hotel pet-friendly?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Is the hotel pet-friendly?'), true);
});

// TC-PT-04: EN pet policy question
test('TC-PT-04: "What is your pet policy?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('What is your pet policy?'), true);
});

// TC-PT-05: Croatian ljubimac (nominative)
test('TC-PT-05: "Smiju li ljubimci?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Smiju li ljubimci?'), true);
});

// TC-PT-06: Croatian kućni ljubimac (full phrase)
test('TC-PT-06: "Primaju li se kućni ljubimci?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Primaju li se kućni ljubimci?'), true);
});

// TC-PT-07: Croatian ljubimac genitive (ljubimaca)
test('TC-PT-07: "Jeste li prihvatljivi za ljubimace?" triggers isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Jeste li prihvatljivi za ljubimace?'), true);
});

// ─── Negative cases: must NOT fire (fall through to GPT) ─────────────────────

// TC-PT-08: 'catalog' contains 'cat' — must NOT fire
test('TC-PT-08: "Do you have a services catalog?" does not trigger isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Do you have a services catalog?'), false);
});

// TC-PT-09: 'pasta' contains 'pas' — must NOT fire
test('TC-PT-09: "Can I order pasta for breakfast?" does not trigger isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Can I order pasta for breakfast?'), false);
});

// TC-PT-10: breakfast question — no pet keyword
test('TC-PT-10: "When is breakfast?" does not trigger isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('When is breakfast?'), false);
});

// TC-PT-11: parking question — no pet keyword
test('TC-PT-11: "Is there parking?" does not trigger isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('Is there parking?'), false);
});

// TC-PT-12: 'category' contains 'cat' — must NOT fire
test('TC-PT-12: "What room category is this?" does not trigger isPetPolicyQuestion', () => {
  assert.equal(isPetPolicyQuestion('What room category is this?'), false);
});

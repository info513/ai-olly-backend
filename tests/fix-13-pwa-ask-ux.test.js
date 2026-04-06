// tests/fix-13-pwa-ask-ux.test.js
//
// Fix #13 — PWA Ask/Request UX hardening:
//   1. askErrorMessage — correct guest-facing copy for each HTTP status
//   2. requestErrorMessage — correct guest-facing copy for request/issue form
//   3. showIssueScreen requestMode contract — documented (DOM, not unit-testable)
//   4. askInFlight guard — documented (async state, not unit-testable)
//
// Functions are replicated verbatim from pwa/app.js (browser code) so we can
// test them deterministically without a DOM or live server.

import { test } from 'node:test';
import assert   from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// Replicated helpers from pwa/app.js
// ═══════════════════════════════════════════════════════════════════════════

function askErrorMessage(status) {
  if (status === 403) return ['Your room link has expired. Please scan the QR code in your room again.', false];
  if (status === 501) return ['Our assistant is temporarily unavailable. Please contact Reception for help.', true];
  if (status === 400) return ['Your question could not be processed. Please try rephrasing it.', false];
  return ['Something went wrong. Please try again or contact Reception directly.', true];
}

function requestErrorMessage(status) {
  if (status === 403) return 'Your room link has expired. Please scan the QR code in your room again.';
  if (status === 400) return 'Some required information is missing. Please check the form and try again.';
  return 'Something went wrong. Please try again or contact Reception directly.';
}

// ═══════════════════════════════════════════════════════════════════════════
// askErrorMessage — TC-AE-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-AE-01: 403 → expired-link message, no contact button
test('TC-AE-01: 403 → expired-link message, showContact=false', () => {
  const [msg, showContact] = askErrorMessage(403);
  assert.equal(showContact, false);
  assert.ok(msg.toLowerCase().includes('qr'), 'message should mention QR code');
});

// TC-AE-02: 501 → unavailable message, contact button shown
test('TC-AE-02: 501 → unavailable message, showContact=true', () => {
  const [msg, showContact] = askErrorMessage(501);
  assert.equal(showContact, true);
  assert.ok(msg.toLowerCase().includes('reception'), 'message should mention Reception');
});

// TC-AE-03: 400 → rephrase message, no contact button
test('TC-AE-03: 400 → rephrase message, showContact=false', () => {
  const [msg, showContact] = askErrorMessage(400);
  assert.equal(showContact, false);
  assert.ok(msg.toLowerCase().includes('rephras'), 'message should suggest rephrasing');
});

// TC-AE-04: 500 → generic fallback, contact button shown
test('TC-AE-04: 500 → generic fallback, showContact=true', () => {
  const [msg, showContact] = askErrorMessage(500);
  assert.equal(showContact, true);
  assert.ok(msg.length > 10, 'fallback message should be non-empty');
});

// TC-AE-05: unknown status → generic fallback (not 400/403/501)
test('TC-AE-05: 429 → generic fallback, showContact=true', () => {
  const [, showContact] = askErrorMessage(429);
  assert.equal(showContact, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// requestErrorMessage — TC-RE-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-RE-01: 403 → expired-link message
test('TC-RE-01: 403 → expired-link message for request form', () => {
  const msg = requestErrorMessage(403);
  assert.ok(msg.toLowerCase().includes('qr'), 'message should mention QR code');
});

// TC-RE-02: 400 → missing-fields message
test('TC-RE-02: 400 → missing-fields message for request form', () => {
  const msg = requestErrorMessage(400);
  assert.ok(msg.toLowerCase().includes('missing') || msg.toLowerCase().includes('check'), 'message should mention form check');
});

// TC-RE-03: 500 → generic fallback
test('TC-RE-03: 500 → generic fallback for request form', () => {
  const msg = requestErrorMessage(500);
  assert.ok(msg.toLowerCase().includes('something went wrong') || msg.toLowerCase().includes('try again'));
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTE — Design contracts (not unit-testable without DOM):
//
// showIssueScreen requestMode contract (Fix #13a):
//   BEFORE fix: requestMode = 'issue' was set BEFORE showScreen('request'),
//   which called resetRequestForm() and overwrote it back to 'request'.
//   updateReqCopy() at the end of showIssueScreen then used 'request' copy,
//   showing "Send a Request" instead of "Report an Issue".
//   AFTER fix: requestMode = 'issue' is set AFTER showScreen('request'),
//   so updateReqCopy() correctly uses 'issue' copy.
//
// askInFlight guard (Fix #13b):
//   Prevents double-submit from rapid Enter presses in the microsecond window
//   before input.disabled takes effect. Guard is reset in the finally block
//   and also in resetAskScreen() when navigating away.
// ═══════════════════════════════════════════════════════════════════════════

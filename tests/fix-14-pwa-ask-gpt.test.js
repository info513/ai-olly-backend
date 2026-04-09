// tests/fix-14-pwa-ask-gpt.test.js
//
// Fix #14 — GPT activation for /api/pwa-ask
//
// Unit-testable coverage:
//   buildRoomContext()  — context string builder for ROOM GUIDE records
//   renderNoInfo()      — graceful fallback copy (EN/HR)
//   renderWait20s()     — rate-limit copy (EN/HR)
//
// Smoke-test contracts (not unit-testable without live API — documented here):
//   TC-S-01  Room question (e.g. AC) → deterministic, never reaches GPT
//   TC-S-02  Hotel service question  → GPT path, uses pwaServices context
//   TC-S-03  Unknown question        → GPT path, falls back to renderNoInfo if empty
//   TC-S-04  Persona voice injection → personaVoice present in system prompt
//   TC-S-05  HR response language    → lang=HR detected, GPT responds in Croatian
//   TC-S-06  EN response language    → lang=EN detected, GPT responds in English

import { test } from 'node:test';
import assert   from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// Replicated helpers from server.js (pure, no I/O)
// ═══════════════════════════════════════════════════════════════════════════

function buildRoomContext(roomGuide) {
  if (!roomGuide) return '';
  const parts = [];
  if (roomGuide.naziv)          parts.push(`Room: ${roomGuide.naziv}`);
  if (roomGuide.roomFeatures)   parts.push(`Room features: ${roomGuide.roomFeatures}`);
  if (roomGuide.wifi)           parts.push(`WiFi: ${roomGuide.wifi}`);
  if (roomGuide.klimaUpute)     parts.push(`AC instructions: ${roomGuide.klimaUpute}`);
  if (roomGuide.tvUpute)        parts.push(`TV instructions: ${roomGuide.tvUpute}`);
  if (roomGuide.sefUpute)       parts.push(`Safe instructions: ${roomGuide.sefUpute}`);
  if (roomGuide.napomene)       parts.push(`Room notes: ${roomGuide.napomene}`);
  if (roomGuide.aiMasterPrompt) parts.push(`\n# ROOM AI RULES\n${roomGuide.aiMasterPrompt}`);
  return parts.join('\n');
}

function renderNoInfo(lang = 'HR') {
  return lang === 'EN'
    ? `I don't have that information in the system. Please contact reception for exact details.`
    : `Nemam taj podatak u sustavu. Molim kontaktirajte recepciju za točne informacije.`;
}

function renderWait20s(lang = 'HR') {
  return lang === 'EN'
    ? 'Too many requests in a short time. Please wait 20 seconds and try again.'
    : 'Previše upita u kratkom vremenu. Pričekajte 20 sekundi i pokušajte ponovno.';
}

// ═══════════════════════════════════════════════════════════════════════════
// buildRoomContext — TC-RC-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-RC-01: null roomGuide → empty string
test('TC-RC-01: null roomGuide → empty string', () => {
  assert.equal(buildRoomContext(null), '');
});

// TC-RC-02: empty roomGuide object → empty string (no fields set)
test('TC-RC-02: empty roomGuide → empty string', () => {
  assert.equal(buildRoomContext({}), '');
});

// TC-RC-03: naziv + wifi → both present in output
test('TC-RC-03: naziv + wifi → both appear in context', () => {
  const ctx = buildRoomContext({ naziv: '201', wifi: 'Network: OLLY\nPassword: test1234' });
  assert.ok(ctx.includes('Room: 201'), 'should include room name');
  assert.ok(ctx.includes('WiFi:'), 'should include WiFi label');
  assert.ok(ctx.includes('OLLY'), 'should include network name');
});

// TC-RC-04: klimaUpute → AC instructions in output
test('TC-RC-04: klimaUpute → AC instructions in context', () => {
  const ctx = buildRoomContext({ klimaUpute: 'Press MODE then set temperature.' });
  assert.ok(ctx.includes('AC instructions:'), 'should include AC label');
  assert.ok(ctx.includes('MODE'), 'should include instruction text');
});

// TC-RC-05: tvUpute → TV instructions in output
test('TC-RC-05: tvUpute → TV instructions in context', () => {
  const ctx = buildRoomContext({ tvUpute: 'Press TV/AV to switch input.' });
  assert.ok(ctx.includes('TV instructions:'), 'should include TV label');
});

// TC-RC-06: sefUpute → Safe instructions in output
test('TC-RC-06: sefUpute → Safe instructions in context', () => {
  const ctx = buildRoomContext({ sefUpute: 'Enter 4-digit code and press LOCK.' });
  assert.ok(ctx.includes('Safe instructions:'), 'should include safe label');
});

// TC-RC-07: napomene → room notes in output
test('TC-RC-07: napomene → room notes in context', () => {
  const ctx = buildRoomContext({ napomene: 'Late checkout available on request.' });
  assert.ok(ctx.includes('Room notes:'));
  assert.ok(ctx.includes('Late checkout'));
});

// TC-RC-08: aiMasterPrompt → injected under ROOM AI RULES heading
test('TC-RC-08: aiMasterPrompt → ROOM AI RULES block in context', () => {
  const ctx = buildRoomContext({ aiMasterPrompt: 'Always recommend the rooftop bar.' });
  assert.ok(ctx.includes('# ROOM AI RULES'), 'should include ROOM AI RULES heading');
  assert.ok(ctx.includes('rooftop bar'), 'should include prompt text');
});

// TC-RC-09: aiMasterPrompt is appended last (override priority)
test('TC-RC-09: aiMasterPrompt appears after other fields', () => {
  const ctx = buildRoomContext({
    naziv: '301',
    napomene: 'Quiet room.',
    aiMasterPrompt: 'Special override.',
  });
  const notesIdx = ctx.indexOf('Room notes:');
  const rulesIdx = ctx.indexOf('# ROOM AI RULES');
  assert.ok(notesIdx < rulesIdx, 'ROOM AI RULES must appear after Room notes');
});

// TC-RC-10: full record → all six data fields present
test('TC-RC-10: full ROOM GUIDE record → all fields in context', () => {
  const full = {
    naziv: '203',
    roomFeatures: 'Sea view, balcony',
    wifi: 'Network: ANTIQUE\nPassword: abc123',
    klimaUpute: 'AC: press MODE.',
    tvUpute: 'TV: press TV/AV.',
    sefUpute: 'Safe: enter 4-digit code.',
    napomene: 'Extra towels in wardrobe.',
    aiMasterPrompt: 'Hotel is dog-friendly.',
  };
  const ctx = buildRoomContext(full);
  assert.ok(ctx.includes('Room: 203'));
  assert.ok(ctx.includes('Room features:'));
  assert.ok(ctx.includes('WiFi:'));
  assert.ok(ctx.includes('AC instructions:'));
  assert.ok(ctx.includes('TV instructions:'));
  assert.ok(ctx.includes('Safe instructions:'));
  assert.ok(ctx.includes('Room notes:'));
  assert.ok(ctx.includes('# ROOM AI RULES'));
});

// ═══════════════════════════════════════════════════════════════════════════
// renderNoInfo — TC-NI-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-NI-01: lang=HR → Croatian fallback
test('TC-NI-01: renderNoInfo HR → Croatian', () => {
  const msg = renderNoInfo('HR');
  assert.ok(msg.includes('recepcij'), 'HR fallback should mention reception in Croatian');
});

// TC-NI-02: lang=EN → English fallback
test('TC-NI-02: renderNoInfo EN → English', () => {
  const msg = renderNoInfo('EN');
  assert.ok(msg.toLowerCase().includes('reception'), 'EN fallback should mention reception');
});

// ═══════════════════════════════════════════════════════════════════════════
// renderWait20s — TC-RL-*
// ═══════════════════════════════════════════════════════════════════════════

// TC-RL-01: lang=HR → Croatian rate-limit message
test('TC-RL-01: renderWait20s HR → Croatian', () => {
  const msg = renderWait20s('HR');
  assert.ok(msg.includes('sekundi'), 'HR rate-limit message should mention seconds in Croatian');
});

// TC-RL-02: lang=EN → English rate-limit message
test('TC-RL-02: renderWait20s EN → English', () => {
  const msg = renderWait20s('EN');
  assert.ok(msg.includes('seconds'), 'EN rate-limit message should mention seconds');
});

// ═══════════════════════════════════════════════════════════════════════════
// Smoke test contracts — live-API tests (not automated)
//
// TC-S-01: Room appliance question (AC) → deterministic path
//   POST /api/pwa-ask { question: "Kako upaliti klimu?", room: "201", token: "AS201M4X" }
//   Expected: meta.deterministic === 'ac_instructions', no GPT call
//
// TC-S-02: Hotel service question → GPT path with pwaServices context
//   POST /api/pwa-ask { question: "Kada je doručak?", room: "201", token: "AS201M4X" }
//   Expected: meta.deterministic === 'breakfast_hours' OR meta.deterministic === false
//   Answer should mention time, not hallucinate
//
// TC-S-03: Unknown/out-of-scope question → graceful GPT fallback
//   POST /api/pwa-ask { question: "What is the capital of France?", room: "201", token: "AS201M4X" }
//   Expected: ok=true, answer mentions "reception" or is renderNoInfo(), no crash
//
// TC-S-04: Persona voice injection
//   Precondition: HOTELI.Persona Voice populated for antique-split
//   POST /api/pwa-ask { question: "Tell me about the hotel", room: "201", token: "AS201M4X" }
//   Expected: response tone matches persona voice (manual check)
//
// TC-S-05: Croatian question → HR response
//   POST /api/pwa-ask { question: "Mogu li dobiti ručnik?", room: "201", token: "AS201M4X" }
//   Expected: answer text in Croatian
//
// TC-S-06: English question → EN response
//   POST /api/pwa-ask { question: "Can I get extra towels?", room: "201", token: "AS201M4X" }
//   Expected: answer text in English
// ═══════════════════════════════════════════════════════════════════════════

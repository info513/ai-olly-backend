/**
 * test-cathedra.mjs — lokalni testovi za AI CATHEDRA endpointe
 *
 * Pokretanje:
 *   1. U jednom terminalu: npm start
 *   2. U drugom terminalu: node test-cathedra.mjs
 *
 * Testira:
 *   T1: GET subjects — ispravan token
 *   T2: GET subjects — krivi token → 403 TOKEN_INVALID
 *   T3: POST exam-registration — uspješna prijava
 *   T4: POST isti predmet opet → 409 ACTIVE_REGISTRATION_EXISTS
 *   T5: POST PRIZNAJE SE predmet → 400 SUBJECT_RECOGNIZED (ako postoji)
 *   T6: POST tuđi predmet → 403 SUBJECT_NOT_ALLOWED
 *   T7: GET subjects — provjera imaAktivnuPrijavu = true za prijavljeni predmet
 *   CLEANUP: poništi testni zapis u PRIJAVE ISPITA
 */

import Airtable from 'airtable';
import 'dotenv/config';

const BASE_URL = `http://localhost:${process.env.PORT || 8080}`;

// Test podaci
const VALID_TOKEN   = 'cathedra_2026_598e3a81a9c16e9497dcc0d9'; // Šimić Manuel
const INVALID_TOKEN = 'krivi-token-ne-postoji-xyz';
const TEST_EP_ID    = 'recBzkhfOej1NWXHo'; // Matematika — ne položen, ne PRIZNAJE SE
const TUDJI_EP_ID   = 'recmas2TT9Svptzmj'; // Goriva i maziva — Lalić Marko (tuđi UPIS)

// Airtable za cleanup — koristi CATHEDRA API ključ
const CAT_TABLE_PI    = 'tblVk6NRhF7ejohC8';
const PI_STATUS_FIELD = 'Status prijave';
const PI_PORUKA_FIELD = 'Poruka prijenosa';
const cathedraAirtable = new Airtable({ apiKey: process.env.CATHEDRA_AIRTABLE_API_KEY });
const cathedraBase     = cathedraAirtable.base(process.env.CATHEDRA_AIRTABLE_BASE_ID);

let createdPrijavaId = null;
let passed = 0;
let failed = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function GET(path) {
  const r = await fetch(`${BASE_URL}${path}`);
  const body = await r.json();
  return { status: r.status, body };
}

async function POST(path, data) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json();
  return { status: r.status, body };
}

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📋 ${title}`);
  console.log('─'.repeat(60));
}

// ── Provjera je li server aktivan ─────────────────────────────────────────────

async function checkServer() {
  try {
    const r = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Testovi ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔬 AI CATHEDRA — Lokalni testovi');
  console.log(`   Server: ${BASE_URL}`);

  const serverUp = await checkServer();
  if (!serverUp) {
    console.error('\n❌ Server nije aktivan! Pokretanje: npm start\n');
    process.exit(1);
  }
  console.log('   Server: ✅ aktivan\n');

  // ── T1: GET subjects — ispravan token ──────────────────────────────────────
  section('T1: GET /api/cathedra/subjects — ispravan token');
  {
    const { status, body } = await GET(`/api/cathedra/subjects?token=${VALID_TOKEN}`);
    console.log(`   Status: ${status}`);
    ok('status 200', status === 200);
    ok('ok: true', body.ok === true);
    ok('subjects je array', Array.isArray(body.subjects));
    ok('ima predmeta', body.subjects?.length > 0, `${body.subjects?.length} predmeta`);

    if (body.subjects?.length > 0) {
      const s = body.subjects[0];
      ok('ima evidencijaPredmetaId', !!s.evidencijaPredmetaId);
      ok('ima naziv', !!s.naziv);
      ok('ima mozePrijaviti', typeof s.mozePrijaviti === 'boolean');
      console.log(`   Primjer predmeta: "${s.naziv}" | razred=${s.razred} | mozePrijaviti=${s.mozePrijaviti}`);
    }

    // Nađi test predmet u listi
    const testSubject = body.subjects?.find(s => s.evidencijaPredmetaId === TEST_EP_ID);
    ok('testni predmet postoji u listi', !!testSubject, TEST_EP_ID);
    if (testSubject) {
      ok('testni predmet mozePrijaviti=true (nije položen, nije PRIZNAJE SE)', testSubject.mozePrijaviti === true);
      console.log(`   Test predmet: "${testSubject.naziv}" | status=${testSubject.statusPredmeta} | polozio=${testSubject.polozio}`);
    }

    // Provjeri PRIZNAJE SE predmete
    const priznatih = body.subjects?.filter(s => s.statusPredmeta === 'PRIZNAJE SE') || [];
    console.log(`   PRIZNAJE SE predmeta: ${priznatih.length}`);
    if (priznatih.length > 0) {
      ok('PRIZNAJE SE predmeti imaju mozePrijaviti=false', priznatih.every(s => !s.mozePrijaviti));
      ok('PRIZNAJE SE predmeti imaju razlog', priznatih.every(s => !!s.razlog));
    }
  }

  // ── T2: GET subjects — krivi token ────────────────────────────────────────
  section('T2: GET /api/cathedra/subjects — krivi token');
  {
    const { status, body } = await GET(`/api/cathedra/subjects?token=${INVALID_TOKEN}`);
    console.log(`   Status: ${status}, error: ${body.error}`);
    ok('status 403', status === 403);
    ok('error TOKEN_INVALID', body.error === 'TOKEN_INVALID');
    ok('ok: false', body.ok === false);
  }

  // ── T3: GET subjects — bez tokena ─────────────────────────────────────────
  section('T3: GET /api/cathedra/subjects — bez tokena');
  {
    const { status, body } = await GET('/api/cathedra/subjects');
    console.log(`   Status: ${status}, error: ${body.error}`);
    ok('status 400', status === 400);
    ok('error MISSING_TOKEN', body.error === 'MISSING_TOKEN');
  }

  // ── T4: POST exam-registration — tuđi predmet ─────────────────────────────
  section('T4: POST exam-registration — tuđi predmet (SUBJECT_NOT_ALLOWED)');
  {
    const { status, body } = await POST('/api/cathedra/exam-registration', {
      token: VALID_TOKEN,
      evidencijaPredmetaId: TUDJI_EP_ID,
    });
    console.log(`   Status: ${status}, error: ${body.error}`);
    ok('status 403', status === 403);
    ok('error SUBJECT_NOT_ALLOWED', body.error === 'SUBJECT_NOT_ALLOWED');
    ok('ok: false', body.ok === false);
  }

  // ── T5: POST exam-registration — uspješna prijava ─────────────────────────
  section('T5: POST exam-registration — uspješna prijava');
  {
    const { status, body } = await POST('/api/cathedra/exam-registration', {
      token: VALID_TOKEN,
      evidencijaPredmetaId: TEST_EP_ID,
    });
    console.log(`   Status: ${status}`);
    console.log(`   Body: ${JSON.stringify(body)}`);
    ok('status 200', status === 200);
    ok('ok: true', body.ok === true);
    ok('status Nova prijava', body.status === 'Nova prijava');
    ok('ima prijavaId', !!body.prijavaId);
    ok('ima message', !!body.message);
    if (body.prijavaId) {
      createdPrijavaId = body.prijavaId;
      console.log(`   ✨ Kreiran zapis: ${createdPrijavaId}`);
    }
  }

  // ── T6: POST isti predmet drugi put — ACTIVE_REGISTRATION_EXISTS ──────────
  section('T6: POST isti predmet opet — duplikat (ACTIVE_REGISTRATION_EXISTS)');
  {
    const { status, body } = await POST('/api/cathedra/exam-registration', {
      token: VALID_TOKEN,
      evidencijaPredmetaId: TEST_EP_ID,
    });
    console.log(`   Status: ${status}, error: ${body.error}`);
    ok('status 409', status === 409);
    ok('error ACTIVE_REGISTRATION_EXISTS', body.error === 'ACTIVE_REGISTRATION_EXISTS');
    ok('ok: false', body.ok === false);
  }

  // ── T7: GET subjects — imaAktivnuPrijavu = true ───────────────────────────
  section('T7: GET subjects — imaAktivnuPrijavu = true za prijavljeni predmet');
  {
    const { status, body } = await GET(`/api/cathedra/subjects?token=${VALID_TOKEN}`);
    ok('status 200', status === 200);
    const testSubject = body.subjects?.find(s => s.evidencijaPredmetaId === TEST_EP_ID);
    ok('testni predmet postoji', !!testSubject);
    if (testSubject) {
      ok('imaAktivnuPrijavu = true', testSubject.imaAktivnuPrijavu === true,
         `imaAktivnuPrijavu=${testSubject.imaAktivnuPrijavu}`);
      ok('mozePrijaviti = false (jer postoji aktivna)', testSubject.mozePrijaviti === false);
      ok('ima razlog', !!testSubject.razlog);
      console.log(`   Razlog: "${testSubject.razlog}"`);
    }
  }

  // ── T8: POST — krivi token ────────────────────────────────────────────────
  section('T8: POST exam-registration — krivi token');
  {
    const { status, body } = await POST('/api/cathedra/exam-registration', {
      token: INVALID_TOKEN,
      evidencijaPredmetaId: TEST_EP_ID,
    });
    console.log(`   Status: ${status}, error: ${body.error}`);
    ok('status 401', status === 401);
    ok('error TOKEN_INVALID', body.error === 'TOKEN_INVALID');
  }

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  section('CLEANUP — poništi testni zapis u PRIJAVE ISPITA');
  if (createdPrijavaId) {
    try {
      await cathedraBase(CAT_TABLE_PI).update(createdPrijavaId, {
        [PI_STATUS_FIELD]: 'Poništeno',
        [PI_PORUKA_FIELD]: 'TEST — poništeno automatski nakon test-cathedra.mjs',
      });
      console.log(`   ✅ Zapis ${createdPrijavaId} poništen (Status=Poništeno)`);
    } catch (e) {
      console.error(`   ❌ Cleanup failed: ${e.message}`);
    }
  } else {
    console.log('   ⚠️  Nema zapisa za cleanup (test prijave nije prošao)');
  }

  // ── Rezultati ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 REZULTATI: ${passed} prošlo / ${failed} palo / ${passed + failed} ukupno`);
  if (failed === 0) {
    console.log('🎉 Svi testovi prošli!\n');
  } else {
    console.log(`⚠️  ${failed} test(ova) palo!\n`);
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Greška u test runner-u:', e);
  process.exit(1);
});

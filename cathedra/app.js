/**
 * AI CATHEDRA — PWA app.js
 * Prijava ispita za polaznike
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────

const TOKEN = new URLSearchParams(window.location.search).get('token') || '';
const API   = '/api/cathedra';

// ── State ─────────────────────────────────────────────────────────────────────

let subjects    = [];
let studentName = '';
let pendingConfirm = null; // { epId, name }

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $list       = document.getElementById('subject-list');
const $studentBar = document.getElementById('student-bar');
const $overlay    = document.getElementById('confirm-overlay');
const $confName   = document.getElementById('confirm-subject-name');
const $confOk     = document.getElementById('confirm-ok');
const $confCancel = document.getElementById('confirm-cancel');
const $toastWrap  = document.getElementById('toast-wrap');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!TOKEN) {
    showFatalError('Nedostaje token. Molimo koristite link koji ste dobili.');
    return;
  }
  loadSubjects();

  $confOk.addEventListener('click', onConfirmOk);
  $confCancel.addEventListener('click', closeModal);
  $overlay.addEventListener('click', e => { if (e.target === $overlay) closeModal(); });
});

// ── API calls ─────────────────────────────────────────────────────────────────

async function loadSubjects() {
  showLoading();
  try {
    const res  = await fetch(`${API}/subjects?token=${encodeURIComponent(TOKEN)}`);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        showFatalError('Token nije ispravan ili je istekao.\nObratite se tajništvu.');
      } else {
        showFatalError(`Greška: ${data.error || res.status}`);
      }
      return;
    }

    subjects    = data.subjects || [];
    studentName = data.studentName || '';
    renderAll();
  } catch (e) {
    showFatalError('Nije moguće spojiti se na server. Provjerite internet vezu.');
  }
}

async function registerExam(epId) {
  // disable button immediately to prevent double-click
  const btn = document.querySelector(`[data-ep="${epId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const res  = await fetch(`${API}/exam-registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, evidencijaPredmetaId: epId }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      toast('Prijava uspješna! ✅', 'ok');
      await loadSubjects(); // refresh list
    } else {
      const msg = friendlyError(data.error);
      toast(msg, 'err');
      // re-enable button so user can retry if needed
      await loadSubjects();
    }
  } catch (e) {
    toast('Greška pri slanju. Pokušajte ponovo.', 'err');
    await loadSubjects();
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  // Student bar
  if (studentName) {
    $studentBar.style.display = 'flex';
    $studentBar.innerHTML = `<span class="student-bar__name">${esc(studentName)}</span>`;
  } else {
    $studentBar.style.display = 'none';
  }

  if (!subjects.length) {
    $list.innerHTML = `
      <div class="state">
        <div class="state__icon">📭</div>
        <div class="state__msg">Nema predmeta za prikaz.</div>
      </div>`;
    return;
  }

  // Group by razred
  const byRazred = {};
  for (const s of subjects) {
    const key = s.razred || 'Ostalo';
    if (!byRazred[key]) byRazred[key] = [];
    byRazred[key].push(s);
  }

  // Map Croatian ordinal razred names to sort order
  const RAZRED_ORDER = {
    'prvi razred': 1, 'drugi razred': 2,
    'treći razred': 3, 'četvrti razred': 4,
  };
  const razredRank = r => RAZRED_ORDER[r.toLowerCase()] ?? 99;

  const sortedRazredi = Object.keys(byRazred).sort((a, b) => {
    const da = razredRank(a), db = razredRank(b);
    if (da !== db) return da - db;
    return a.localeCompare(b, 'hr');
  });

  let html = '';
  for (const razred of sortedRazredi) {
    // razred may be a full string ("Prvi razred") or a number ("1")
    const num = parseInt(razred);
    const label = isNaN(num) ? razred : `${num}. razred`;
    html += `<div class="section-title">${esc(label)}</div>`;
    for (const s of byRazred[razred]) {
      html += renderCard(s);
    }
  }

  $list.innerHTML = html;

  // Attach click handlers
  $list.querySelectorAll('.btn--primary[data-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const epId = btn.dataset.ep;
      const subj = subjects.find(s => s.evidencijaPredmetaId === epId);
      openModal(epId, subj?.naziv || '');
    });
  });
}

function renderCard(s) {
  const { evidencijaPredmetaId: epId, naziv, mozePrijaviti,
          imaAktivnuPrijavu, polozio, statusPredmeta, razlog } = s;

  let btnHtml = '';
  let metaHtml = '';

  if (polozio) {
    btnHtml  = `<button class="btn btn--success" disabled>✓ Položio</button>`;
    metaHtml = `<span class="badge badge--green">Položen</span>`;
  } else if (statusPredmeta === 'PRIZNAJE SE') {
    btnHtml  = `<button class="btn btn--ghost" disabled>Priznato</button>`;
    metaHtml = `<span class="badge badge--blue">Priznaje se</span>`;
    if (razlog) metaHtml += ` <span style="color:var(--clr-muted);font-size:.75rem;">${esc(razlog)}</span>`;
  } else if (imaAktivnuPrijavu) {
    btnHtml  = `<button class="btn btn--warn" disabled>⏳ Prijavljeno</button>`;
    metaHtml = `<span class="badge badge--yellow">Aktivna prijava</span>`;
    if (razlog) metaHtml += ` <span style="color:var(--clr-muted);font-size:.75rem;">${esc(razlog)}</span>`;
  } else if (mozePrijaviti) {
    btnHtml = `<button class="btn btn--primary" data-ep="${esc(epId)}">Prijavi</button>`;
  } else {
    // locked — not allowed for some other reason
    btnHtml  = `<button class="btn btn--ghost" disabled>—</button>`;
    if (razlog) metaHtml = `<span style="color:var(--clr-muted);font-size:.75rem;">${esc(razlog)}</span>`;
  }

  return `
    <div class="card">
      <div class="card__info">
        <div class="card__name">${esc(naziv || '(bez naziva)')}</div>
        <div class="card__meta">${metaHtml || '&nbsp;'}</div>
      </div>
      ${btnHtml}
    </div>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(epId, name) {
  pendingConfirm = { epId, name };
  $confName.textContent = name;
  $overlay.classList.add('open');
}

function closeModal() {
  $overlay.classList.remove('open');
  pendingConfirm = null;
}

async function onConfirmOk() {
  if (!pendingConfirm) return;
  const { epId } = pendingConfirm;
  closeModal();
  await registerExam(epId);
}

// ── Loading / error states ────────────────────────────────────────────────────

function showLoading() {
  $list.innerHTML = `
    <div class="state">
      <div class="spinner"></div>
      <div class="state__msg">Učitavanje predmeta…</div>
    </div>`;
}

function showFatalError(msg) {
  $list.innerHTML = `
    <div class="state">
      <div class="state__icon">⚠️</div>
      <div class="state__msg">${esc(msg)}</div>
    </div>`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast--' + type : ''}`;
  el.textContent = msg;
  $toastWrap.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('toast--visible'));
  });

  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function friendlyError(code) {
  const map = {
    TOKEN_INVALID:               'Token nije ispravan.',
    MISSING_TOKEN:               'Nedostaje token.',
    SUBJECT_NOT_ALLOWED:         'Predmet nije u vašem upisnom listu.',
    SUBJECT_RECOGNIZED:          'Predmet je priznat — nije potrebna prijava.',
    SUBJECT_ALREADY_PASSED:      'Predmet je već položen.',
    ACTIVE_REGISTRATION_EXISTS:  'Već imate aktivnu prijavu za ovaj predmet.',
    UPIS_NOT_FOUND:              'Nije pronađen upisni list.',
    MISSING_FIELDS:              'Nedostaju podaci. Pokušajte ponovo.',
    SERVER_ERROR:                'Greška na serveru. Pokušajte ponovo.',
  };
  return map[code] || `Greška: ${code || 'nepoznata'}`;
}

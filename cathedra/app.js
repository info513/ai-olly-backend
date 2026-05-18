/**
 * AI CATHEDRA — app.js
 * Prijava ispita za polaznike
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────

const TOKEN = new URLSearchParams(window.location.search).get('token') || '';
const API   = '/api/cathedra';

// ── State ─────────────────────────────────────────────────────────────────────

let subjects     = [];
let studentName  = '';
let activeFilter = 'sve';
let pendingEpId  = null;
let registering  = false; // guard against double-submit

// ── Razred sort order ─────────────────────────────────────────────────────────

const RAZRED_ORDER = {
  'prvi razred':    1,
  'drugi razred':   2,
  'treći razred':   3,
  'četvrti razred': 4,
};

const razredRank = r => RAZRED_ORDER[(r || '').toLowerCase()] ?? 99;

// ── Filter definitions ────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'sve',       label: 'Sve',        test: () => true },
  { id: 'prijava',   label: 'Za prijavu', test: s => s.mozePrijaviti },
  { id: 'prijavljeno',label:'Prijavljeno',test: s => s.imaAktivnuPrijavu },
  { id: 'priznato',  label: 'Priznato',   test: s => s.statusPredmeta === 'PRIZNAJE SE' },
  { id: 'polozeno',  label: 'Položeno',   test: s => s.polozio },
];

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $hero    = document.getElementById('hero-section');
const $filters = document.getElementById('filter-section');
const $list    = document.getElementById('subject-list');
const $overlay = document.getElementById('confirm-overlay');
const $confName= document.getElementById('confirm-subject-name');
const $confOk  = document.getElementById('confirm-ok');
const $confCancel = document.getElementById('confirm-cancel');
const $toastWrap  = document.getElementById('toast-wrap');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!TOKEN) {
    renderFatal(
      '🔒',
      'Pristup nije valjan',
      'Nedostaje autentifikacijski token. Molimo koristite link koji ste dobili od administracije.'
    );
    return;
  }

  $confOk.addEventListener('click', onConfirmOk);
  $confCancel.addEventListener('click', closeModal);
  $overlay.addEventListener('click', e => { if (e.target === $overlay) closeModal(); });

  loadSubjects();
});

// ── API ───────────────────────────────────────────────────────────────────────

async function loadSubjects(silent = false) {
  if (!silent) renderLoading();

  try {
    const res  = await fetch(`${API}/subjects?token=${encodeURIComponent(TOKEN)}`);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403 || res.status === 401 || data.error === 'TOKEN_INVALID') {
        renderFatal(
          '🔒',
          'Pristup nije valjan',
          'Token nije ispravan ili je istekao. Molimo kontaktirajte administraciju.'
        );
      } else {
        renderFatal('⚠️', 'Greška', `Greška servera: ${data.error || res.status}`);
      }
      return;
    }

    subjects    = data.subjects || [];
    studentName = data.studentName || '';
    renderAll();
  } catch {
    renderFatal(
      '📡',
      'Nije moguće spojiti se',
      'Provjerite internetsku vezu i pokušajte osvježiti stranicu.'
    );
  }
}

async function registerExam(epId) {
  if (registering) return;
  registering = true;

  // Optimistically disable the button
  const btn = document.querySelector(`.btn--primary[data-ep="${CSS.escape(epId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Šaljem…'; }

  try {
    const res  = await fetch(`${API}/exam-registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, evidencijaPredmetaId: epId }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      toast('Vaša prijava ispita je zaprimljena. ✅', 'ok');
    } else {
      toast(friendlyError(data.error), 'err');
    }
  } catch {
    toast('Greška pri slanju. Pokušajte ponovo.', 'err');
  } finally {
    registering = false;
    await loadSubjects(true); // silent refresh — no loading spinner
  }
}

// ── Render: full page ─────────────────────────────────────────────────────────

function renderAll() {
  renderHero();
  renderFilters();
  renderSubjects();
}

// ── Hero card ─────────────────────────────────────────────────────────────────

function renderHero() {
  const name = studentName || 'Moji predmeti';
  const total = subjects.length;
  const canRegister = subjects.filter(s => s.mozePrijaviti).length;
  const registered  = subjects.filter(s => s.imaAktivnuPrijavu).length;
  const passed      = subjects.filter(s => s.polozio).length;

  $hero.innerHTML = `
    <div class="hero">
      <div class="hero__label">Prijava ispita</div>
      <div class="hero__name">${esc(name)}</div>
      <div class="hero__sub">Ovdje možete pregledati predmete i poslati prijavu za ispit.</div>
      <div class="hero__meta">
        <span class="hero__chip">📚 ${total} predmeta</span>
        ${canRegister > 0 ? `<span class="hero__chip">✏️ ${canRegister} za prijavu</span>` : ''}
        ${registered  > 0 ? `<span class="hero__chip">⏳ ${registered} prijavljeno</span>` : ''}
        ${passed      > 0 ? `<span class="hero__chip">✓ ${passed} položeno</span>` : ''}
      </div>
    </div>`;
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

function renderFilters() {
  const html = FILTERS.map(f => {
    const count = subjects.filter(f.test).length;
    const active = f.id === activeFilter ? ' active' : '';
    return `
      <button class="filter-btn${active}" data-filter="${esc(f.id)}">
        ${esc(f.label)}
        <span class="count">${count}</span>
      </button>`;
  }).join('');

  $filters.innerHTML = `<div class="filters">${html}</div>`;

  $filters.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFilters();  // re-render tabs with new active
      renderSubjects(); // re-render list
    });
  });
}

// ── Subject list ──────────────────────────────────────────────────────────────

function renderSubjects() {
  const filterFn = FILTERS.find(f => f.id === activeFilter)?.test ?? (() => true);
  const visible  = subjects.filter(filterFn);

  if (!subjects.length) {
    $list.innerHTML = `
      <div class="state">
        <div class="state__icon">📭</div>
        <div class="state__title">Nema predmeta za prikaz</div>
        <div class="state__msg">Trenutno nema dostupnih predmeta u vašem upisnom listu.</div>
      </div>`;
    return;
  }

  // Group visible subjects by razred
  const byRazred = {};
  for (const s of visible) {
    const key = s.razred || 'Ostalo';
    if (!byRazred[key]) byRazred[key] = [];
    byRazred[key].push(s);
  }

  // Sort razredi
  const sortedRazredi = Object.keys(byRazred).sort((a, b) => {
    const ra = razredRank(a), rb = razredRank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b, 'hr');
  });

  // Within each razred: RAZLIKOVNI first, then rest sorted by naziv
  for (const r of sortedRazredi) {
    byRazred[r].sort((a, b) => {
      const ranka = a.statusPredmeta === 'RAZLIKOVNI' ? 0 : 1;
      const rankb = b.statusPredmeta === 'RAZLIKOVNI' ? 0 : 1;
      if (ranka !== rankb) return ranka - rankb;
      return (a.naziv || '').localeCompare(b.naziv || '', 'hr');
    });
  }

  let html = '';

  if (visible.length === 0) {
    html = `<div class="empty-filter">Nema predmeta koji odgovaraju odabranom filteru.</div>`;
  } else {
    for (const razred of sortedRazredi) {
      const cards = byRazred[razred].map(renderCard).join('');
      html += `
        <div class="section-heading">
          <span class="section-heading__label">${esc(razred)}</span>
          <span class="section-heading__line"></span>
        </div>
        <div class="subject-grid">${cards}</div>`;
    }
  }

  $list.innerHTML = html;

  // Attach click events to Prijavi buttons
  $list.querySelectorAll('.btn--primary[data-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const epId = btn.dataset.ep;
      const subj = subjects.find(s => s.evidencijaPredmetaId === epId);
      openModal(epId, subj?.naziv || '');
    });
  });
}

// ── Card renderer ─────────────────────────────────────────────────────────────

function renderCard(s) {
  const { evidencijaPredmetaId: epId, naziv, razred,
          mozePrijaviti, imaAktivnuPrijavu, polozio,
          statusPredmeta, razlog } = s;

  let badges = '';
  let statusText = '';
  let btn = '';
  let cardMod = '';

  if (polozio) {
    cardMod    = 'card--polozio';
    badges     = badge('green', '✓ Položeno');
    statusText = 'Predmet je položen.';
    btn        = btnEl('success', 'Položeno', true);

  } else if (statusPredmeta === 'PRIZNAJE SE') {
    cardMod    = 'card--poznat';
    badges     = badge('blue', 'Priznaje se');
    statusText = razlog || 'Predmet je priznat — ne prijavljuje se za ispit.';
    btn        = btnEl('ghost', 'Priznato', true);

  } else if (statusPredmeta === 'RAZLIKOVNI') {
    cardMod    = 'card--razlikovni';
    badges     = badge('orange', 'Razlikovni');
    if (imaAktivnuPrijavu) {
      badges    += ' ' + badge('yellow', 'Prijavljeno');
      statusText = razlog || 'Prijava je zaprimljena.';
      btn        = btnEl('warn', '⏳ Već prijavljeno', true);
    } else if (mozePrijaviti) {
      statusText = 'Razlikovni predmet — prijava dostupna.';
      btn        = `<button class="btn btn--primary" data-ep="${esc(epId)}">Prijavi ispit</button>`;
    } else {
      statusText = razlog || '';
      btn        = btnEl('ghost', '—', true);
    }

  } else if (imaAktivnuPrijavu) {
    badges     = badge('yellow', '⏳ Prijavljeno');
    statusText = razlog || 'Prijava je zaprimljena.';
    btn        = btnEl('warn', 'Već prijavljeno', true);

  } else if (mozePrijaviti) {
    badges     = badge('gray', 'Redovni');
    statusText = 'Prijava ispita dostupna.';
    btn        = `<button class="btn btn--primary" data-ep="${esc(epId)}">Prijavi ispit</button>`;

  } else {
    badges     = badge('gray', statusPredmeta || 'Nedostupno');
    statusText = razlog || '';
    btn        = btnEl('ghost', '—', true);
  }

  return `
    <div class="card${cardMod ? ' ' + cardMod : ''}">
      <div class="card__top">
        <div class="card__info">
          <div class="card__name">${esc(naziv || '(bez naziva)')}</div>
          <div class="card__razred">${esc(razred || '')}</div>
        </div>
      </div>
      ${badges ? `<div class="card__badges">${badges}</div>` : ''}
      ${statusText ? `<div class="card__status-text">${esc(statusText)}</div>` : ''}
      <div class="card__action">${btn}</div>
    </div>`;
}

function badge(color, text) {
  return `<span class="badge badge--${esc(color)}">${esc(text)}</span>`;
}

function btnEl(variant, label, disabled = false) {
  return `<button class="btn btn--${esc(variant)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(epId, name) {
  pendingEpId = epId;
  $confName.textContent = name;
  $overlay.classList.add('open');
  $confOk.focus();
}

function closeModal() {
  $overlay.classList.remove('open');
  pendingEpId = null;
}

async function onConfirmOk() {
  if (!pendingEpId) return;
  const epId = pendingEpId;
  closeModal();
  await registerExam(epId);
}

// ── Loading / fatal states ────────────────────────────────────────────────────

function renderLoading() {
  $hero.innerHTML = '';
  $filters.innerHTML = '';
  $list.innerHTML = `
    <div class="state">
      <div class="spinner"></div>
      <div class="state__title">Učitavanje predmeta…</div>
      <div class="state__msg">Molimo pričekajte.</div>
    </div>`;
}

function renderFatal(icon, title, msg) {
  $hero.innerHTML = '';
  $filters.innerHTML = '';
  $list.innerHTML = `
    <div class="state">
      <div class="state__icon">${icon}</div>
      <div class="state__title">${esc(title)}</div>
      <div class="state__msg">${esc(msg)}</div>
    </div>`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast--' + type : ''}`;
  el.textContent = msg;
  $toastWrap.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 4000);
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function friendlyError(code) {
  const map = {
    TOKEN_INVALID:              'Token nije ispravan.',
    MISSING_TOKEN:              'Nedostaje token.',
    SUBJECT_NOT_ALLOWED:        'Predmet nije u vašem upisnom listu.',
    SUBJECT_RECOGNIZED:         'Predmet je priznat — nije potrebna prijava.',
    SUBJECT_ALREADY_PASSED:     'Predmet je već položen.',
    ACTIVE_REGISTRATION_EXISTS: 'Već imate aktivnu prijavu za ovaj predmet.',
    UPIS_NOT_FOUND:             'Nije pronađen upisni list.',
    MISSING_FIELDS:             'Nedostaju podaci. Pokušajte ponovo.',
    SERVER_ERROR:               'Greška na serveru. Pokušajte ponovo.',
  };
  return map[code] || `Greška: ${code || 'nepoznata'}`;
}

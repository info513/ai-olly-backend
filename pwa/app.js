// app.js — AI Olly PWA v1
// Steps 1–7: shell, URL parsing, Welcome (dynamic), Contact, Send Request, Report Issue, Ask.

// ── URL params ────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const SLUG    = params.get('slug')  || '';
const ROOM    = params.get('room')  || '';
const TOKEN   = params.get('token') || '';

// ── Navigation ────────────────────────────────────────────────────────────
let currentScreen = 'welcome';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('screen-' + name);
  if (target) {
    target.classList.add('active');
    currentScreen = name;
    window.scrollTo(0, 0);
  }
  if (name === 'request') resetRequestForm();
  if (name === 'ask')     resetAskScreen();
}

// ── Request form state ────────────────────────────────────────────────────
let selectedCategory = '';
let selectedPriority = 'Normal';
let requestMode = 'request'; // 'request' | 'issue'

const COPY = {
  request: {
    title:       'Send a Request',
    catLabel:    'What do you need?',
    msgLabel:    'Describe your request',
    placeholder: 'Tell us what you need...',
    submit:      'Send Request',
    successHeading: 'Request sent',
    successText:    'Reception has been notified and will take care of it shortly.',
  },
  issue: {
    title:       'Report an Issue',
    catLabel:    'What type of issue?',
    msgLabel:    'Describe the issue',
    placeholder: 'Tell us what happened...',
    submit:      'Report Issue',
    successHeading: 'Issue reported',
    successText:    'Reception has been notified and will look into this right away.',
  },
};

function updateReqCopy() {
  const c = COPY[requestMode];
  setText('req-screen-title', c.title);
  setText('req-cat-label',    c.catLabel);
  setText('req-msg-label',    c.msgLabel);
  setText('req-submit-btn',   c.submit);
  setText('req-success-heading', c.successHeading);
  setText('req-success-text',    c.successText);
  const msgEl = document.getElementById('req-message');
  if (msgEl) msgEl.placeholder = c.placeholder;
}

function showIssueScreen() {
  requestMode = 'issue';
  showScreen('request');        // resets form, then we override below
  selectCategory('Issue / Complaint');
  updateReqCopy();
}

function selectCategory(cat) {
  selectedCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('cat-btn--selected', btn.textContent.trim() === cat);
  });
  hide('cat-error');
}

function selectPriority(prio) {
  selectedPriority = prio;
  document.getElementById('prio-normal').classList.toggle('prio-btn--selected', prio === 'Normal');
  document.getElementById('prio-urgent').classList.toggle('prio-btn--selected', prio === 'Urgent');
  const hint = document.getElementById('prio-hint');
  if (hint) hint.classList.toggle('prio-hint--visible', prio === 'Urgent');
}

function clearFieldError(id) {
  hide(id);
  const msg = document.getElementById('req-message');
  if (msg) msg.classList.remove('form-textarea--error');
}

function resetRequestForm() {
  selectedCategory = '';
  selectedPriority = 'Normal';
  requestMode = 'request';
  updateReqCopy();

  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('cat-btn--selected'));
  document.getElementById('prio-normal').classList.add('prio-btn--selected');
  document.getElementById('prio-urgent').classList.remove('prio-btn--selected');

  const msg = document.getElementById('req-message');
  if (msg) { msg.value = ''; msg.classList.remove('form-textarea--error'); }

  const name = document.getElementById('req-name');
  if (name) name.value = '';

  const hint = document.getElementById('prio-hint');
  if (hint) hint.classList.remove('prio-hint--visible');

  hide('cat-error');
  hide('msg-error');
  hide('submit-error');

  showReqView('form');
}

function showReqView(view) {
  // view = 'form' | 'loading' | 'success'
  setHidden('req-form',    view !== 'form');
  setHidden('req-loading', view !== 'loading');
  setHidden('req-success', view !== 'success');
}

// ── Submit request ────────────────────────────────────────────────────────
async function submitRequest() {
  // Client-side validation
  let valid = true;

  if (!selectedCategory) {
    show('cat-error');
    valid = false;
  }

  const msgEl = document.getElementById('req-message');
  const message = msgEl ? msgEl.value.trim() : '';
  if (!message) {
    show('msg-error');
    if (msgEl) msgEl.classList.add('form-textarea--error');
    valid = false;
  }

  if (!valid) return;

  const guestName = (document.getElementById('req-name')?.value || '').trim();

  const body = {
    slug:     SLUG || 'antique-split',
    room:     ROOM,
    token:    TOKEN,
    category: selectedCategory,
    message,
    priority: selectedPriority,
  };
  if (guestName) body.guestName = guestName;

  showReqView('loading');

  try {
    const res = await fetch((CONFIG.apiBase || '') + '/api/pwa-request', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      const refEl = document.getElementById('success-ref');
      if (refEl) refEl.textContent = data.requestId ? 'Ref: ' + data.requestId : '';
      showReqView('success');
      return;
    }

    // Error path — go back to form with message
    showReqView('form');
    const errEl = document.getElementById('submit-error');
    if (errEl) {
      errEl.textContent = errorMessage(res.status, data.error);
      show('submit-error');
    }

  } catch (err) {
    showReqView('form');
    const errEl = document.getElementById('submit-error');
    if (errEl) {
      errEl.textContent = 'Unable to connect. Please check your connection or contact Reception directly.';
      show('submit-error');
    }
  }
}

function errorMessage(status, serverMsg) {
  if (status === 403) return 'Your room link has expired. Please scan the QR code in your room again.';
  if (status === 400) return 'Some required information is missing. Please check the form and try again.';
  return 'Something went wrong. Please try again or contact Reception directly.';
}

// ── Ask Assistant ─────────────────────────────────────────────────────────

function resetAskScreen() {
  const input = document.getElementById('ask-input');
  if (input) { input.value = ''; input.disabled = false; }
  const btn = document.getElementById('ask-btn');
  if (btn) btn.disabled = true;
  hide('ask-loading');
  hide('ask-answer-card');
  hide('ask-error');
  hide('ask-contact-hint');
}

function onAskInput() {
  const input = document.getElementById('ask-input');
  const btn   = document.getElementById('ask-btn');
  if (btn) btn.disabled = !(input && input.value.trim());
}

function onAskKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); submitAsk(); }
}

async function submitAsk() {
  const input    = document.getElementById('ask-input');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  const btn = document.getElementById('ask-btn');
  if (input) input.disabled = true;
  if (btn)   btn.disabled   = true;

  hide('ask-answer-card');
  hide('ask-error');
  hide('ask-contact-hint');
  show('ask-loading');

  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN, question }),
    });
    const data = await res.json().catch(() => ({}));

    hide('ask-loading');
    if (input) input.disabled = false;
    if (btn)   btn.disabled   = !input?.value.trim();

    if (res.ok && data.ok && data.answer) {
      setText('ask-answer-text', data.answer);
      show('ask-answer-card');
      return;
    }

    const [errMsg, showContact] = askErrorMessage(res.status);
    setText('ask-error', errMsg);
    show('ask-error');
    if (showContact) show('ask-contact-hint');

  } catch (_) {
    hide('ask-loading');
    const input2 = document.getElementById('ask-input');
    const btn2   = document.getElementById('ask-btn');
    if (input2) input2.disabled = false;
    if (btn2)   btn2.disabled   = !input2?.value.trim();
    setText('ask-error', 'Unable to connect. Please check your connection and try again.');
    show('ask-error');
  }
}

function askErrorMessage(status) {
  // returns [message, showContactButton]
  if (status === 403) return ['Your room link has expired. Please scan the QR code in your room again.', false];
  if (status === 501) return ['Our assistant is temporarily unavailable. Please contact Reception for help.', true];
  if (status === 400) return ['Your question could not be processed. Please try rephrasing it.', false];
  return ['Something went wrong. Please try again or contact Reception directly.', true];
}

// ── DOM helpers ───────────────────────────────────────────────────────────
function hide(id)              { const el = document.getElementById(id); if (el) el.hidden = true;  }
function show(id)              { const el = document.getElementById(id); if (el) el.hidden = false; }
function setHidden(id, state)  { const el = document.getElementById(id); if (el) el.hidden = state; }
function setText(id, text)     { const el = document.getElementById(id); if (el) el.textContent = text; }

// ── Boot ──────────────────────────────────────────────────────────────────
function boot() {
  const roomEl = document.getElementById('room-number');
  if (roomEl) roomEl.textContent = ROOM || '—';

  const hotelEl = document.getElementById('hotel-name');
  if (hotelEl) hotelEl.textContent = CONFIG.hotelName;

  // Contact screen
  const phoneLink = document.getElementById('contact-phone');
  if (phoneLink) phoneLink.href = 'tel:' + CONFIG.phone;

  const phoneDisplay = document.getElementById('phone-display');
  if (phoneDisplay) phoneDisplay.textContent = CONFIG.phone;

  const waLink = document.getElementById('contact-whatsapp');
  if (waLink) waLink.href = 'https://wa.me/' + CONFIG.whatsapp;

  const receptionNote = document.getElementById('reception-note');
  if (receptionNote) receptionNote.textContent = CONFIG.reception;

  if (!ROOM || !TOKEN) show('param-warning');

  showScreen('welcome');

  // Load per-room welcome text after screen is shown — silent fallback on failure
  if (ROOM && TOKEN) fetchWelcomeData();
}

async function fetchWelcomeData() {
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-welcome', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;                     // 403 / 500 — stay silent, static fallback
    const data = await res.json();
    if (!data.ok) return;

    if (data.hotelName) setText('hotel-name', data.hotelName);
    if (data.aiWelcome) {
      setText('welcome-text', data.aiWelcome);
      show('welcome-text');
    }
  } catch (_) {
    // Network error — welcome screen already showing, do nothing
  }
}

document.addEventListener('DOMContentLoaded', boot);

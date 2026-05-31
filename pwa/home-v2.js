// home-v2.js — AI Olly Home V2 Prototype
// Self-contained: mock data embedded. No API calls.
// In production, replace MOCK_* constants with real API responses.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2: Hotel Config — per-property JSON
// In production: loaded from /api/pwa-config?slug=...
// ─────────────────────────────────────────────────────────────────────────────
const HOTEL_CONFIG = {
  propertyId:    'antique-split',
  name:          'Antique Split',
  city:          'Split, HR',
  coordinates:   [43.5081, 16.4402],
  assistantName: 'Dioclea',
  culturalSeries: {
    title:    'Whispers of the Palace',
    episodes: 9,
    active:   true,
  },
  supportHours: '9–22h',
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3: Mock dynamic content
// In production: fetched from /api/pwa-welcome, /api/pwa-pois, etc.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_GUEST = {
  firstName: 'Marko',
  room:      '201',
  roomType:  'Deluxe',
  checkOut:  '2026-06-06',
};

const MOCK_WEATHER = {
  mode:      'sunny',  // sunny | hot | cloudy_mild | rainy | stormy_windy | evening
  tempC:     26,
  condition: 'Sunny',
  hiC:       29,
  loC:       18,
  city:      'Split',
  forecast: [
    { day: 'Today', icon: 'ico-sun',        tempC: 26, hiC: 29, loC: 18 },
    { day: 'Mon',   icon: 'ico-sun',        tempC: 24, hiC: 27, loC: 16 },
    { day: 'Tue',   icon: 'ico-cloud-sun',  tempC: 21, hiC: 23, loC: 15 },
    { day: 'Wed',   icon: 'ico-cloud-rain', tempC: 17, hiC: 20, loC: 13 },
    { day: 'Thu',   icon: 'ico-sun',        tempC: 23, hiC: 26, loC: 16 },
  ],
};

// 11 POIs — seeded for prototype; production comes from /api/pwa-pois
const MOCK_POIS = [
  {
    id:        'peristyle',
    name:      'Peristyle',
    category:  'Roman',
    distanceM: 50,
    gradient:  'linear-gradient(155deg, #2c1a0e 0%, #5c3820 55%, #3a2510 100%)',
  },
  {
    id:        'riva',
    name:      'Riva Promenade',
    category:  'Waterfront',
    distanceM: 100,
    gradient:  'linear-gradient(155deg, #0a1824 0%, #0e2d40 55%, #0a2030 100%)',
  },
  {
    id:        'cathedral',
    name:      'Cathedral of St Domnius',
    category:  'Church',
    distanceM: 80,
    gradient:  'linear-gradient(155deg, #1a1000 0%, #3a2800 55%, #241800 100%)',
  },
  {
    id:        'vestibule',
    name:      'Vestibule',
    category:  'Roman',
    distanceM: 60,
    gradient:  'linear-gradient(155deg, #1a0e20 0%, #2a1a3e 55%, #1a1428 100%)',
  },
  {
    id:        'golden-gate',
    name:      'Golden Gate',
    category:  'Roman',
    distanceM: 200,
    gradient:  'linear-gradient(155deg, #1e1200 0%, #3a2a10 55%, #281c08 100%)',
  },
  {
    id:        'cellars',
    name:      'Diocletian’s Cellars',
    category:  'Roman',
    distanceM: 70,
    gradient:  'linear-gradient(155deg, #0e0e0e 0%, #1c1810 55%, #0a0a0a 100%)',
  },
  {
    id:        'bacvice',
    name:      'Bačvice Beach',
    category:  'Beach',
    distanceM: 800,
    gradient:  'linear-gradient(155deg, #083050 0%, #0e4870 55%, #083850 100%)',
  },
  {
    id:        'green-market',
    name:      'Green Market',
    category:  'Market',
    distanceM: 400,
    gradient:  'linear-gradient(155deg, #0e1e0a 0%, #1c3a10 55%, #0a1808 100%)',
  },
  {
    id:        'varos',
    name:      'Varoš Quarter',
    category:  'Neighbourhood',
    distanceM: 300,
    gradient:  'linear-gradient(155deg, #1e0e1a 0%, #3a1a30 55%, #281420 100%)',
  },
  {
    id:        'mestrovic',
    name:      'Meštrović Gallery',
    category:  'Museum',
    distanceM: 1200,
    gradient:  'linear-gradient(155deg, #1a1400 0%, #302800 55%, #201c00 100%)',
  },
  {
    id:        'city-museum',
    name:      'City Museum',
    category:  'Museum',
    distanceM: 150,
    gradient:  'linear-gradient(155deg, #14221e 0%, #1c3830 55%, #102018 100%)',
  },
];

// Split Today — weather-aware engine output (mock)
// In production: generated server-side from weather + POI data
const MOCK_SPLIT_TODAY = {
  mode:       'sunny',
  timeOfDay:  'morning',
  moodTitle:  'A perfect morning for the stones',
  moodSub:    'Sunny · 26° · Ideal for the old town before noon',
  pois: [
    { name: 'Peristyle',               distanceM: 50  },
    { name: 'Vestibule',               distanceM: 60  },
    { name: 'Cathedral of St Domnius', distanceM: 80  },
    { name: 'Riva Promenade',          distanceM: 100 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Template layer — Quick Access tile definitions
// No hotel-specific content; label copy is generic platform text.
// ─────────────────────────────────────────────────────────────────────────────
const QUICK_TILES = [
  { id: 'room-guide', label: 'Room Guide',      icon: 'ico-bed',      concierge: false },
  { id: 'services',   label: 'Hotel Services',  icon: 'ico-services', concierge: false },
  { id: 'near-me',    label: 'Near Me',         icon: 'ico-nearme',   concierge: false },
  { id: 'concierge',  label: 'Concierge',       icon: 'ico-bell',     concierge: true  },
  { id: 'routes',     label: 'Routes',          icon: 'ico-routes',   concierge: false },
  { id: 'help',       label: 'Help &amp; Requests', icon: 'ico-help', concierge: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function v2Esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function v2FormatDist(m) {
  if (m < 1000) return m + ' m';
  return (m / 1000).toFixed(1).replace('.0', '') + ' km';
}

function v2FormatCheckout(iso) {
  var d = new Date(iso + 'T12:00:00');
  var days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()];
}

function v2Greeting() {
  var h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function v2WeatherIconId(mode) {
  if (mode === 'rainy' || mode === 'stormy_windy') return 'ico-cloud-rain';
  if (mode === 'evening') return 'ico-moon';
  return 'ico-sun';
}

// Toast
var _toastTimer = null;
function v2Toast(msg) {
  var el = document.getElementById('v2-toast');
  if (!el) return;
  el.innerHTML = msg;
  el.classList.add('v2-toast--show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.remove('v2-toast--show'); }, 2600);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: Hero
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderHero() {
  var $ = function (id) { return document.getElementById(id); };

  // Text fields
  var timeEl = $('v2-time');
  var nameEl = $('v2-name');
  var atEl   = $('v2-at');
  var roomEl = $('v2-room');
  var rtEl   = $('v2-rtype');
  var coEl   = $('v2-checkout');

  if (timeEl) timeEl.textContent = v2Greeting();
  if (nameEl) nameEl.textContent = MOCK_GUEST.firstName;
  if (atEl)   atEl.textContent   = 'at ' + HOTEL_CONFIG.name;
  if (roomEl) roomEl.textContent = 'Room ' + MOCK_GUEST.room;
  if (rtEl)   rtEl.textContent   = MOCK_GUEST.roomType;
  if (coEl)   coEl.textContent   = 'Check-out ' + v2FormatCheckout(MOCK_GUEST.checkOut);

  // Weather pill — collapsed state
  var tempEl = $('v2-temp');
  var condEl = $('v2-wx-cond');
  var hlEl   = $('v2-wx-hl');
  var iconEl = $('v2-wx-icon');

  if (tempEl) tempEl.innerHTML = MOCK_WEATHER.tempC + '&deg;';
  if (condEl) condEl.textContent = MOCK_WEATHER.condition;
  if (hlEl)   hlEl.innerHTML = 'H:' + MOCK_WEATHER.hiC + ' &middot; L:' + MOCK_WEATHER.loC;

  // Swap weather icon
  if (iconEl) {
    var use = iconEl.querySelector('use');
    if (use) use.setAttribute('href', '#' + v2WeatherIconId(MOCK_WEATHER.mode));
  }

  // Render 5-day forecast (hidden initially)
  v2RenderForecast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: 5-day forecast panel
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderForecast() {
  var container = document.getElementById('v2-wx-days');
  if (!container) return;

  container.innerHTML = MOCK_WEATHER.forecast.map(function (day, i) {
    var labelCls = 'v2-wx-day__label' + (i === 0 ? ' v2-wx-day__label--today' : '');
    return (
      '<div class="v2-wx-day">' +
        '<span class="' + labelCls + '">' + v2Esc(day.day) + '</span>' +
        '<span class="v2-wx-day__icon">' +
          '<svg class="v2-icon v2-icon--sm"><use href="#' + day.icon + '"/></svg>' +
        '</span>' +
        '<span class="v2-wx-day__temp">' + day.tempC + '&deg;</span>' +
        '<span class="v2-wx-day__hl">' + day.hiC + '&deg;&nbsp;' + day.loC + '&deg;</span>' +
      '</div>'
    );
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle: expand / collapse 5-day forecast
// ─────────────────────────────────────────────────────────────────────────────
var _wxOpen = false;

function v2ToggleWeather() {
  _wxOpen = !_wxOpen;
  var panel  = document.getElementById('v2-wx-forecast');
  var pill   = document.getElementById('v2-wx-pill');
  var hint   = document.querySelector('.v2-wx-pill__hint span');

  if (panel) {
    panel.classList.toggle('v2-wx-forecast--open', _wxOpen);
    panel.setAttribute('aria-hidden', String(!_wxOpen));
  }
  if (pill) {
    pill.classList.toggle('v2-wx-pill--open', _wxOpen);
  }
  if (hint) {
    hint.textContent = _wxOpen ? 'Collapse' : 'Tap for 5-day';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: Quick Access
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderQuickAccess() {
  var grid = document.getElementById('v2-tile-grid');
  if (!grid) return;

  grid.innerHTML = QUICK_TILES.map(function (tile) {
    var cls = 'v2-tile' + (tile.concierge ? ' v2-tile--concierge' : '');
    return (
      '<div class="' + cls + '" onclick="v2TileTap(\'' + tile.id + '\')">' +
        '<div class="v2-tile__icon">' +
          '<svg class="v2-icon v2-icon--sm"><use href="#' + tile.icon + '"/></svg>' +
        '</div>' +
        '<span class="v2-tile__label">' + tile.label + '</span>' +
      '</div>'
    );
  }).join('');
}

function v2TileTap(id) {
  // In production: call pushScreen(id) or openModule(id) from app.js
  var labels = {
    'room-guide': 'Room Guide',
    'services':   'Hotel Services',
    'near-me':    'Near Me',
    'concierge':  'Concierge',
    'routes':     'Routes',
    'help':       'Help & Requests',
  };
  v2Toast((labels[id] || id) + ' – would open in production');
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: Steps from your door
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderSteps() {
  var scroll = document.getElementById('v2-poi-scroll');
  if (!scroll) return;

  scroll.innerHTML = MOCK_POIS.map(function (poi) {
    return (
      '<div class="v2-poi-card" onclick="v2Toast(\'' + v2Esc(poi.name) + '\')">' +
        '<div class="v2-poi-card__bg" style="background:' + poi.gradient + '"></div>' +
        '<div class="v2-poi-card__dist">' + v2FormatDist(poi.distanceM) + '</div>' +
        '<div class="v2-poi-card__body">' +
          '<div class="v2-poi-card__name">' + v2Esc(poi.name) + '</div>' +
          '<div class="v2-poi-card__cat">' + v2Esc(poi.category) + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: Split Today
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderSplitToday() {
  var card = document.getElementById('v2-today-card');
  if (!card) return;

  var today = MOCK_SPLIT_TODAY;

  var poisHtml = today.pois.map(function (p) {
    return (
      '<div class="v2-today-poi-row" onclick="v2Toast(\'' + v2Esc(p.name) + '\')">' +
        '<div class="v2-today-poi-dot"></div>' +
        '<div class="v2-today-poi-name">' + v2Esc(p.name) + '</div>' +
        '<div class="v2-today-poi-dist">' + v2FormatDist(p.distanceM) + '</div>' +
      '</div>'
    );
  }).join('');

  card.innerHTML =
    '<div class="v2-today-hd">' +
      '<span class="v2-today-tag">Split Today &middot; Weather-Aware</span>' +
      '<button class="v2-today-see-all" onclick="v2Toast(\'See all\')">See all ' +
        '<svg class="v2-icon v2-icon--xs"><use href="#ico-arrow-right"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="v2-today-mood">' +
      '<div class="v2-today-mood__title">' + v2Esc(today.moodTitle) + '</div>' +
      '<div class="v2-today-mood__sub">' + today.moodSub + '</div>' +
    '</div>' +
    '<div class="v2-today-pois">' + poisHtml + '</div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: Whispers of the Palace (conditional on hotel config)
// ─────────────────────────────────────────────────────────────────────────────
function v2RenderWhispers() {
  var section = document.getElementById('v2-whispers-section');
  if (!section) return;

  var cs = HOTEL_CONFIG.culturalSeries;
  if (!cs || !cs.active) {
    section.style.display = 'none';
    return;
  }
  section.style.removeProperty('display');

  var card = document.getElementById('v2-whispers-card');
  if (!card) return;

  card.innerHTML =
    '<div class="v2-whispers-badge">' +
      '<svg class="v2-icon v2-icon--xs"><use href="#ico-book-open"/></svg>' +
      'Cultural Series' +
    '</div>' +
    '<div class="v2-whispers-title">' + v2Esc(cs.title) + '</div>' +
    '<div class="v2-whispers-sub">' +
      'The story of Diocletian, Salona and the Palace that became a city.' +
    '</div>' +
    '<div class="v2-whispers-ft">' +
      '<span class="v2-whispers-count">' + cs.episodes + ' chapters</span>' +
      '<span class="v2-whispers-cta">' +
        'Enter the Palace ' +
        '<svg class="v2-icon v2-icon--sm"><use href="#ico-arrow-right"/></svg>' +
      '</span>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask bubble + tooltip
// ─────────────────────────────────────────────────────────────────────────────
function v2InitAskBubble() {
  var tip = document.getElementById('v2-ask-tip');
  if (!tip) return;

  // Personalise tooltip text from hotel config
  tip.innerHTML =
    'Ask ' + v2Esc(HOTEL_CONFIG.assistantName) + ' anything about your stay.' +
    '<span class="v2-ask-tip-arrow"></span>';

  var seen = localStorage.getItem('olly_tooltip_seen');
  if (seen) {
    tip.classList.add('v2-ask-tip--out');
    return;
  }

  function dismissTip() {
    tip.classList.add('v2-ask-tip--out');
    localStorage.setItem('olly_tooltip_seen', 'true');
  }

  // Auto-dismiss after 6 s
  var autoDismiss = setTimeout(dismissTip, 6000);

  tip.addEventListener('click', function () {
    clearTimeout(autoDismiss);
    dismissTip();
  }, { once: true });

  // Dismiss on tap anywhere outside the bubble wrap
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#v2-ask-wrap')) {
      clearTimeout(autoDismiss);
      dismissTip();
    }
  }, { once: true, capture: true });
}

function v2AskTap() {
  var tip = document.getElementById('v2-ask-tip');
  if (tip && !tip.classList.contains('v2-ask-tip--out')) {
    tip.classList.add('v2-ask-tip--out');
    localStorage.setItem('olly_tooltip_seen', 'true');
  }
  // In production: pushScreen('ask') or gotoRoot('ask') from app.js
  v2Toast('Ask ' + HOTEL_CONFIG.assistantName + ' – chat opens here');
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  v2RenderHero();
  v2RenderQuickAccess();
  v2RenderSteps();
  v2RenderSplitToday();
  v2RenderWhispers();
  v2InitAskBubble();
});

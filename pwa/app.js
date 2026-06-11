// app.js — AI Olly PWA v2
// Full guest guide dashboard with navigation stack, maps, room guide,
// services, routes, near me, ask, requests and contact.

// ── URL params ────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const SLUG   = params.get('slug')  || '';
const ROOM   = params.get('room')  || '';
const TOKEN  = params.get('token') || '';

// ── Module state ──────────────────────────────────────────────────────────
let GOOGLE_REVIEW_URL = ''; // set from /api/pwa-welcome response
let feedbackRatings   = {}; // { overall, room_score, staff, location, cleanliness }
let roomGuideData    = null;
let servicesData     = null;
let serviceCategories = [];  // [{cat, icon, items:[{s,i}]}] built during renderServicesList
let servicesScrollY  = 0;    // saved scroll position for services list
let poisData         = null; // loaded from /api/pwa-pois
let routesData       = null; // loaded from /api/pwa-routes
let partnersData     = null; // loaded from /api/pwa-partners (Concierge)
let eventsData           = null; // loaded from /api/pwa-events (legacy)
let splitTodayEventsData = null; // loaded from /api/pwa-split-today-events { today, thisWeek, upcoming }
let currentEvent         = null; // currently open event
let currentService   = null;
let currentPoi       = null;
let currentRoute     = null;
let currentPartner   = null; // currently selected restaurant/partner
let currentConciForm = null; // 'taxi' | 'boat' | 'shuttle' | 'restaurant' | 'wakeup'
let currentNmCat     = null;
let cityMapObj       = null;
let cityMapInited    = false;
let routeMapObj      = null;
let poiMarkers       = [];   // { marker, poi, idx } — for category filtering
let selectedPoiEntry = null; // currently highlighted marker entry

// ── Navigation stack ──────────────────────────────────────────────────────
const ROOT_SCREENS = new Set(['home', 'city-map', 'ask', 'info']);
let currentScreen  = 'home';
let navStack       = [];

function _activateScreen(name, direction = 'forward') {
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.remove('active', 'entering', 'entering-back');
  });
  const el = document.getElementById('screen-' + name);
  if (el) {
    el.classList.add('active');
    // Trigger entrance animation on next frame so CSS transition picks it up
    requestAnimationFrame(() => {
      el.classList.add(direction === 'back' ? 'entering-back' : 'entering');
    });
    currentScreen = name;
  }
  window.scrollTo(0, 0);
  updateBottomNav(name);

  // Hide floating ask bubble when on the ask screen itself; restore when leaving
  const askWrap = document.getElementById('v2-ask-wrap');
  if (askWrap) askWrap.hidden = (name === 'ask');

  // Leaflet invalidation — must happen after the element is visible
  if (name === 'city-map' && cityMapObj) {
    setTimeout(() => cityMapObj.invalidateSize(), 120);
  }
  if (name === 'route-map' && routeMapObj) {
    setTimeout(() => routeMapObj.invalidateSize(), 120);
  }

  // Screen-specific init / render
  if (name === 'city-map-welcome') {
    _startWelcomeSlideshow();
    _updateWelcomeMeta();
  }
  if (name === 'city-map') {
    _stopWelcomeSlideshow();
    // Use class-based visibility (CSS transform), not hidden attribute
    const mc = document.getElementById('poi-mini-card');
    if (mc) mc.classList.remove('visible');
    setHidden('poi-loading-hint', !!poisData);
    if (!cityMapInited) initCityMap();
  }
  if (name === 'room-guide') renderRoomGuideSections();
  if (name === 'services') {
    renderServicesList();
    // Restore scroll position when going back from a service category or detail
    if (direction === 'back') {
      requestAnimationFrame(() => window.scrollTo(0, servicesScrollY));
    }
  }
  if (name === 'services-category') {
    // scroll restored by pushScreen → window.scrollTo(0,0)
  }
  if (name === 'routes')    renderRoutesList();
  if (name === 'concierge') {
    if (!partnersData) loadPartners();
    else renderConciergeRestaurants();
  }
  if (name === 'events') {
    // Reset to Weather Picks tab on each open
    activeEventsTab = 'today';
    document.querySelectorAll('.st-tab').forEach((b, i) => b.classList.toggle('st-tab--active', i === 0));
    if (!splitTodayEventsData) loadSplitTodayEvents();
    renderEventsList();
    // Populate weather badge from whatever is already in the V2 pill
    const wxCondEl = document.getElementById('v2-wx-cond');
    const wxTempEl = document.getElementById('v2-temp');
    const wxCond = wxCondEl && wxCondEl.textContent.trim() !== ' ' ? wxCondEl.textContent.trim() : '';
    const wxTemp = wxTempEl ? parseInt(wxTempEl.textContent) : NaN;
    _v2UpdateEventsWeatherBadge(wxCond || null, isNaN(wxTemp) ? undefined : wxTemp);
  }
  if (name === 'feedback') _activateFeedbackScreen();
  if (name === 'whispers-intro') _initWhispersIntroHero();
  if (name === 'whispers-list')  renderWhispersChapterList();
}

function pushScreen(name) {
  if (name === currentScreen) return;
  navStack.push(currentScreen);
  _activateScreen(name);
}

function popScreen() {
  const prev = navStack.pop();
  _activateScreen(prev || 'home', 'back');
}

function gotoRoot(name) {
  navStack = [];
  _activateScreen(name);
}

function updateBottomNav(name) {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const isRoot = ROOT_SCREENS.has(name);
  nav.hidden = !isRoot;
  nav.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('bottom-nav-item--active', btn.dataset.screen === name);
  });
}

// ── Home ──────────────────────────────────────────────────────────────────
function openModule(name) {
  pushScreen(name);
}

// ── Room Guide ────────────────────────────────────────────────────────────
function renderRoomGuideSections() {
  // Static sections in HTML — just manage loading indicator
  if (roomGuideData) {
    hide('rg-loading');
  } else {
    show('rg-loading');
  }
}

function openRoomGuideSection(section) {
  const sectionMap = {
    wifi:        'WiFi',
    ac:          'Air Conditioning',
    tv:          'TV',
    safe:        'Safe',
    smartglass:  'Smart Glass Window',
    features:    'Room Features',
    notes:       'Room Notes',
  };
  setText('rg-section-title', sectionMap[section] || section);
  renderRoomSection(section);
  pushScreen('room-guide-section');
}

function renderRoomSection(section) {
  const body = document.getElementById('rg-section-body');
  if (!body) return;

  if (!roomGuideData) {
    body.innerHTML = '<div class="rg-content"><div class="rg-content-block"><p class="rg-content-text">Room information is loading. Please try again in a moment.</p></div></div>';
    return;
  }

  let html = '<div class="rg-content">';

  if (section === 'wifi') {
    const raw = roomGuideData.wifi || '';
    if (raw) {
      const lines = raw.split('\n').filter(l => l.trim());
      let network = '', password = '';
      lines.forEach(line => {
        if (/network|ssid|mre[žz]a|naziv/i.test(line)) {
          network = line.replace(/.*[:：]/,'').trim();
        } else if (/pass|lozinka|[šs]ifra/i.test(line)) {
          password = line.replace(/.*[:：]/,'').trim();
        }
      });
      if (network || password) {
        if (network) html += `<div class="rg-content-block"><h3>Network</h3><div class="rg-content-text">${escHtml(network)}</div></div>`;
        if (password) html += `<div class="rg-content-block"><h3>Password</h3><div class="rg-wifi-password">${escHtml(password)}</div></div>`;
      } else {
        html += `<div class="rg-content-block"><div class="rg-content-text">${escHtml(raw)}</div></div>`;
      }
    } else {
      html += `<div class="rg-content-block"><p class="rg-content-text">WiFi details are not available. Please contact Reception.</p></div>`;
    }
  } else if (section === 'ac') {
    const text = roomGuideData.klimaUpute || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">Air conditioning instructions are not available. Please contact Reception.</p></div>`;
  } else if (section === 'tv') {
    const text = roomGuideData.tvUpute || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">TV instructions are not available. Please contact Reception.</p></div>`;
  } else if (section === 'safe') {
    const text = roomGuideData.sefUpute || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">Safe instructions are not available. Please contact Reception.</p></div>`;
  } else if (section === 'smartglass') {
    const text = roomGuideData.smartGlass || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">Your room is equipped with a smart glass window system. Use the wall switch to change between clear and private mode. If you need help, please contact Reception.</p></div>`;
  } else if (section === 'features') {
    const text = roomGuideData.roomFeatures || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">Room feature details are not listed for this room.</p></div>`;
  } else if (section === 'notes') {
    const text = roomGuideData.napomene || '';
    html += text
      ? `<div class="rg-content-block"><div class="rg-content-text">${escHtml(text)}</div></div>`
      : `<div class="rg-content-block"><p class="rg-content-text">No additional notes for this room.</p></div>`;
  }

  html += `<div class="detail-actions detail-actions--row">
    <button class="action-btn" onclick="gotoRoot('ask')">Ask Olly</button>
    <button class="action-btn action-btn--primary" onclick="pushScreen('contact')">Reception</button>
  </div>`;

  html += '</div>';
  body.innerHTML = html;
}

// ── SVG Icon System ───────────────────────────────────────────────────────
// Centralised map: icon name → SVG inner paths (24×24 viewBox, Feather/Lucide)
const OLLY_ICONS = {
  // Services & accommodation
  bell:           `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  bed:            `<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>`,
  sparkle:        `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>`,
  coffee:         `<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/>`,
  car:            `<path d="M19 17H5v-8l2-4h10l2 4v8z"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>`,
  clipboard:      `<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>`,
  star:           `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  // Transport
  walking:        `<circle cx="12" cy="4" r="1"/><path d="m6.8 20 1.2-7 2 2 2-8"/><path d="m16 20-2-9"/><path d="M7.2 11.8 10 10l3.5 1.5"/>`,
  bike:           `<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>`,
  anchor:         `<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="21"/><path d="M5 15H2a10 10 0 0 0 20 0h-3"/>`,
  ferry:          `<path d="M2 21c0 0 3-2 10-2s10 2 10 2"/><path d="M2 14l10-3 10 3"/><path d="M5 14V9l7-4 7 4v5"/>`,
  taxi:           `<path d="M10 2h4"/><path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>`,
  bus:            `<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>`,
  shuttle:        `<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>`,
  // Places / POI
  landmark:       `<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>`,
  church:         `<path d="m18 7 4 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9l4-2"/><path d="M14 22v-4a2 2 0 0 0-4 0v4"/><path d="M18 22V5l-6-3-6 3v17"/><path d="M12 7v5"/><path d="M10 9h4"/>`,
  binoculars:     `<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M14 16h-4"/><path d="M6 12V7l3-3h6l3 3v5"/><line x1="12" y1="4" x2="12" y2="7"/>`,
  waves:          `<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>`,
  beach:          `<path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>`,
  leaf:           `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>`,
  'shopping-bag': `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>`,
  music:          `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  'credit-card':  `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  pill:           `<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>`,
  'map-pin':      `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  // Meta & actions
  map:            `<polygon points="3 6 3 22 10 18 17 22 21 18 21 2 17 6 10 2 3 6"/><line x1="10" y1="2" x2="10" y2="18"/><line x1="17" y1="6" x2="17" y2="22"/>`,
  clock:          `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  alarm:          `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="m5 3-3 3m20-3-3 3"/>`,
  phone:          `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 12 19.79 19.79 0 0 1 1.06 3.4 2 2 0 0 1 3.03 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 8.91A16 16 0 0 0 13 14.82l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21 16z"/>`,
  alert:          `<path d="m10.29 3.86-8.47 14.67A2 2 0 0 0 3.54 21h16.92a2 2 0 0 0 1.72-3.47L13.71 2.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
  wifi:           `<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9A16 16 0 0 1 22.58 9"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`,
  snowflake:      `<line x1="12" y1="2" x2="12" y2="22"/><path d="m17 7-5-5-5 5"/><path d="m17 17-5 5-5-5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="m7 7-5 5 5 5"/><path d="m17 7 5 5-5 5"/>`,
  tv:             `<rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>`,
  lock:           `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  utensils:       `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><line x1="7" y1="2" x2="7" y2="11"/><path d="M21 15V2a5 5 0 0 0-5 5v6h3l-1 8h3l-1-8h1z"/>`,
  wine:           `<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H7c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z"/>`,
  moon:           `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  dollar:         `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  drama:          `<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>`,
  kayak:          `<path d="M2 12h20"/><path d="m6 8-4 4 4 4"/><path d="m18 8 4 4-4 4"/><circle cx="12" cy="12" r="2"/>`,
  history:        `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>`,
  parking:        `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>`,
  cart:           `<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>`,
  beer:           `<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 3 11 3s2 .5 3 .5 1.5-.5 2-.5a2.5 2.5 0 0 1 0 5c-.5 0-1-.5-2-.5z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>`,
  siren:          `<path d="M11.5 2h1v2h-1z"/><path d="M3.05 12.29A9 9 0 0 1 21 12"/><path d="M3 16h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.26 6.26 1.41 1.41"/><path d="m16.33 7.67 1.41-1.41"/>`,
  ambulance:      `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  // Weather
  'w-sun':        `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  'w-cloud-sun':  `<path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/><path d="M10.5 8.5a4 4 0 0 1 0 8H7a3 3 0 0 1 0-6h.5a4 4 0 0 1 3-2z"/>`,
  'w-cloud':      `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>`,
  'w-fog':        `<path d="M5 5h3m4 0h9M3 10h11m4 0h1M1 15h14m4 0h1M5 20h5m4 0h5"/>`,
  'w-rain':       `<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="19" x2="8" y2="21"/><line x1="8" y1="23" x2="8" y2="24"/><line x1="12" y1="18" x2="12" y2="20"/><line x1="12" y1="22" x2="12" y2="23"/><line x1="16" y1="19" x2="16" y2="21"/><line x1="16" y1="23" x2="16" y2="24"/>`,
  'w-snow':       `<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="20" x2="8" y2="24"/><line x1="12" y1="20" x2="12" y2="24"/><line x1="16" y1="20" x2="16" y2="24"/>`,
  'w-storm':      `<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><polyline points="13 11 9 17 15 17 11 23"/>`,
};

// Returns an inline SVG string. size defaults to 20; color defaults to currentColor.
function _icon(name, size, color) {
  const sz   = size  || 20;
  const col  = color || 'currentColor';
  const body = OLLY_ICONS[name] || OLLY_ICONS['map-pin'];
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle;">${body}</svg>`;
}

// ── Hotel Services ────────────────────────────────────────────────────────

function _routeIcon(type) {
  const t = (type || '').toLowerCase();
  if (/cycl|bike/.test(t))       return _icon('bike');
  if (/driv|car/.test(t))        return _icon('car');
  if (/boat|sea|kayak/.test(t))  return _icon('anchor');
  return _icon('walking');
}

const SERVICE_GROUPS = [
  { id: 'arrival', icon: 'bell', label: 'Arrival & Departure',
    keywords: ['check-in', 'check in', 'check out', 'check-out', 'late check',
               'early check', 'luggage', 'tourist tax', 'invoice', 'payment',
               'r1 receipt', 'key policy', 'front desk', 'direct booking',
               'booking & offers', 'booking and offers', 'arrival & departure'] },
  { id: 'guest-services', icon: 'star', label: 'Guest Services',
    keywords: ['beauty', 'complimentary', 'gift voucher', 'special occasion',
               'anniversary', 'birthday', 'book club', 'additional service',
               'welcome drink', 'luggage storage', 'premium service',
               'concierge service', 'personalised', 'personalized', 'guest service',
               'private tour', 'tour guide'] },
  { id: 'room', icon: 'bed', label: 'Room Comfort',
    keywords: ['minibar', 'pillow', 'blanket', 'room service'] },
  { id: 'housekeeping', icon: 'sparkle', label: 'Housekeeping & Laundry',
    keywords: ['housekeep', 'laundry', 'towel', 'linen', 'clean',
               'do not disturb', 'fabric softener', 'washing not', 'drying not'] },
  { id: 'food', icon: 'coffee', label: 'Breakfast & Food',
    keywords: ['food and beverage', 'food & beverage', 'beverage', 'breakfast',
               'dietary', 'kids breakfast', 'room breakfast', 'local food',
               'drink', 'meal', 'dining', 'where locals eat'] },
  { id: 'transport', icon: 'car', label: 'Transport & Parking',
    keywords: ['parking', 'airport', 'taxi', 'ferry', 'bus station',
               'boat tour', 'island trip', 'private transport', 'transfer', 'shuttle'] },
  { id: 'policies', icon: 'clipboard', label: 'Policies & Safety',
    keywords: ['house rule', 'safety', 'security', 'emergency', 'fire',
               'smoking', 'pet policy', 'quiet hour', 'cooking not',
               'cctv', 'rule', 'policy', 'payment method'] },
];

function _mapServiceToGroup(s) {
  const cats = Array.isArray(s.kategorija) ? s.kategorija : [s.kategorija || ''];
  const text = [...cats, s.naziv || ''].join(' ').toLowerCase();
  for (const g of SERVICE_GROUPS) {
    if (g.keywords.some(kw => text.includes(kw.toLowerCase()))) return g.id;
  }
  return 'arrival'; // fallback — never show "Other"
}

function renderServicesList() {
  const container = document.getElementById('services-list');
  if (!container) return;
  if (!servicesData) {
    show('services-loading');
    hide('services-empty');
    container.innerHTML = '';
    return;
  }
  hide('services-loading');
  if (!servicesData.length) {
    show('services-empty');
    return;
  }
  hide('services-empty');

  const groupMap = {};
  SERVICE_GROUPS.forEach(g => { groupMap[g.id] = []; });
  servicesData.forEach((s, i) => {
    groupMap[_mapServiceToGroup(s)].push({ s, i });
  });

  serviceCategories = SERVICE_GROUPS
    .filter(g => groupMap[g.id].length > 0)
    .map(g => ({ cat: g.label, icon: g.icon, items: groupMap[g.id] }));

  container.innerHTML = `<div class="section-list">${
    serviceCategories.map((entry, idx) => `
      <div class="section-item" onclick="openServicesCategory(${idx})">
        ${_icon(entry.icon)}
        <span>${escHtml(entry.cat)}</span>
        <span class="section-arrow">&#8250;</span>
      </div>`).join('')
  }</div>`;
}

function openServicesCategory(idx) {
  const entry = serviceCategories[idx];
  if (!entry) return;
  setText('svc-cat-screen-title', entry.cat);
  const container = document.getElementById('services-cat-list');
  if (container) {
    container.innerHTML = `<div class="section-list">${
      entry.items.map(({ s, i }) => `
        <div class="section-item" onclick="openServiceDetail(${i})">
          ${_icon(entry.icon)}
          <span>${escHtml(s.naziv || '')}</span>
          <span class="section-arrow">&#8250;</span>
        </div>`).join('')
    }</div>`;
  }
  pushScreen('services-category');
}


function openServiceDetail(idx) {
  currentService = servicesData ? servicesData[idx] : null;
  if (!currentService) return;

  // Save scroll so we can restore it when going back
  servicesScrollY = window.scrollY;

  const cats = Array.isArray(currentService.kategorija) ? currentService.kategorija.join(', ') : '';
  setText('svc-category', cats);
  setText('svc-title',        currentService.naziv || '');
  setText('svc-screen-title', currentService.naziv || '');

  // Description — strip URLs then render as markdown
  const rawOpisDesc = currentService.opis || '';
  const cleanDesc   = _stripUrls(rawOpisDesc).trim();
  const descEl = document.getElementById('svc-desc');
  if (descEl) descEl.innerHTML = _renderMarkdown(cleanDesc);

  // Booking URL button — detect https link in opis (not wa.me)
  const bookingUrl = _extractFirstUrl(rawOpisDesc, ['wa.me']);
  const bookingBtn = document.getElementById('svc-booking-btn');
  if (bookingBtn) {
    bookingBtn.hidden = !bookingUrl;
    if (bookingUrl) {
      bookingBtn.href = bookingUrl;
      try {
        const domain = new URL(bookingUrl).hostname.replace(/^www\./, '');
        bookingBtn.textContent = 'Book on ' + domain + ' \u2192';
      } catch { bookingBtn.textContent = 'Book now \u2192'; }
    }
  }

  // Emergency buttons — show 112, 194 and reception for emergency/urgent services
  const combined    = [currentService.naziv, ...(currentService.kategorija || [])].join(' ').toLowerCase();
  const isEmergency = /emergency|hitno|urgent|sos|112|194/.test(combined);
  const btn112 = document.getElementById('svc-112-btn');
  const btn194 = document.getElementById('svc-194-btn');
  const emergencyBtn = document.getElementById('svc-emergency-btn');
  if (btn112)      btn112.hidden      = !isEmergency;
  if (btn194)      btn194.hidden      = !isEmergency;
  if (emergencyBtn) {
    emergencyBtn.hidden = !isEmergency;
    if (isEmergency) {
      const phone = CONFIG.phone || '';
      emergencyBtn.href        = phone ? 'tel:' + phone : '#';
      emergencyBtn.textContent = '\uD83D\uDCDE\u2009Call Reception' + (phone ? '\u2009\u00b7\u2009' + phone : '');
    }
  }

  pushScreen('service-detail');
}

// ── City Map Welcome ──────────────────────────────────────────────────────

// Images to cycle in the welcome slideshow.
// Drop 1080×1920 JPG/WebP files into /pwa/img/ and list them here.
const MAP_WELCOME_IMAGES = [
  // 'img/split-1.jpg',
  // 'img/split-2.jpg',
  // 'img/split-3.jpg',
];

let _welcomeSlideIdx     = 0;
let _welcomeSlideTimer   = null;
const SLIDE_DURATION_MS  = 5000;

function openCityMapWelcome() {
  // If already on the actual map, just show it (no double welcome)
  if (currentScreen === 'city-map') return;
  pushScreen('city-map-welcome');
}

function _startWelcomeSlideshow() {
  const slides = document.querySelectorAll('.map-welcome-slide');
  const dotsEl = document.getElementById('map-welcome-dots');

  // Apply image backgrounds if provided
  slides.forEach((el, i) => {
    if (MAP_WELCOME_IMAGES[i]) {
      el.style.backgroundImage = `url('${MAP_WELCOME_IMAGES[i]}')`;
    }
  });

  // Build dots (only if > 1 image)
  const total = Math.max(slides.length, 1);
  if (dotsEl) {
    dotsEl.innerHTML = Array.from({ length: total }, (_, i) =>
      `<div class="map-welcome-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _welcomeSlideIdx = 0;
  _activateWelcomeSlide(0);

  clearInterval(_welcomeSlideTimer);
  _welcomeSlideTimer = setInterval(() => {
    _welcomeSlideIdx = (_welcomeSlideIdx + 1) % slides.length;
    _activateWelcomeSlide(_welcomeSlideIdx);
  }, SLIDE_DURATION_MS);
}

function _activateWelcomeSlide(idx) {
  document.querySelectorAll('.map-welcome-slide').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  document.querySelectorAll('.map-welcome-dot').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

function _stopWelcomeSlideshow() {
  clearInterval(_welcomeSlideTimer);
  _welcomeSlideTimer = null;
}

// Update meta line with live POI/route counts once data loads
function _updateWelcomeMeta() {
  const el = document.getElementById('map-welcome-meta');
  if (!el) return;
  const poiCount   = poisData   ? poisData.filter(p => p.coords).length : null;
  const routeCount = routesData ? routesData.length : null;
  if (poiCount !== null || routeCount !== null) {
    const parts = [];
    if (poiCount   !== null) parts.push(`${poiCount} points of interest`);
    if (routeCount !== null) parts.push(`${routeCount} walking route${routeCount !== 1 ? 's' : ''}`);
    el.textContent = parts.join(' · ');
  }
}

// ── City Map ──────────────────────────────────────────────────────────────

// Map each POI category string to an icon name (used with _icon()).
// Covers both English Airtable values (Culture, History, Religion, Square,
// Viewpoint, Waterfront, Nature, Market, Park, Street) and legacy Croatian names.
function _categoryIcon(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('plaža') || c.includes('beach') || c.includes('kupanje')) return 'beach';
  if (c.includes('restoran') || c.includes('restaurant'))                   return 'utensils';
  if (c.includes('kafić') || c.includes('kava') || c.includes('cafe') ||
      c.includes('bar') || c.includes('lounge'))                            return 'coffee';
  if (c.includes('religion') || c.includes('crkva') ||
      c.includes('cathedral') || c.includes('chapel'))                      return 'church';
  if (c.includes('viewpoint') || c.includes('pogled') ||
      c.includes('vidikovac'))                                               return 'binoculars';
  if (c.includes('waterfront') || c.includes('promenade') ||
      c.includes('harbour') || c.includes('marina') ||
      c.includes('luka') || c.includes('obala'))                            return 'waves';
  if (c.includes('square') || c.includes('trg'))                           return 'landmark';
  if (c.includes('street') || c.includes('ulica'))                         return 'walking';
  if (c.includes('culture') || c.includes('crkva') || c.includes('palača') ||
      c.includes('muzej') || c.includes('kulturno') ||
      c.includes('landmark') || c.includes('history') ||
      c.includes('museum'))                                                  return 'landmark';
  if (c.includes('park') || c.includes('priroda') ||
      c.includes('nature') || c.includes('garden'))                         return 'leaf';
  if (c.includes('kupovina') || c.includes('shop') ||
      c.includes('market') || c.includes('tržnica'))                        return 'shopping-bag';
  if (c.includes('trajekt') || c.includes('ferry') ||
      c.includes('prijevoz') || c.includes('transport'))                    return 'ferry';
  if (c.includes('noćni') || c.includes('night') || c.includes('club'))    return 'music';
  if (c.includes('atm') || c.includes('bankomat'))                         return 'credit-card';
  if (c.includes('ljekarna') || c.includes('pharmacy'))                    return 'pill';
  return 'map-pin';
}

function createPoiIcon(category) {
  const ico = _categoryIcon(category);
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;background:#fff;border:2.5px solid #c9a227;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.22);cursor:pointer;">${_icon(ico, 17, '#2c1f14')}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Selected state — larger, dark background, gold ring, pulse animation via CSS class
function createPoiIconSelected(category) {
  const ico = _categoryIcon(category);
  return L.divIcon({
    className: 'poi-marker-selected',
    html: `<div style="width:42px;height:42px;background:#2c1f14;border:3px solid #c9a227;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 6px rgba(201,162,39,0.25),0 4px 16px rgba(0,0,0,0.4);cursor:pointer;">${_icon(ico, 22, '#f5edd8')}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

// Set a marker as selected (highlights it); resets the previous one
function setSelectedPoiMarker(idx) {
  // Reset previous selection
  if (selectedPoiEntry) {
    selectedPoiEntry.marker.setIcon(createPoiIcon(selectedPoiEntry.poi.category));
    selectedPoiEntry = null;
  }
  if (idx == null) return;
  const entry = poiMarkers.find(m => m.idx === idx);
  if (entry) {
    entry.marker.setIcon(createPoiIconSelected(entry.poi.category));
    selectedPoiEntry = entry;
  }
}

function initCityMap() {
  if (cityMapInited) return;
  const el = document.getElementById('city-map-leaflet');
  if (!el || typeof L === 'undefined') {
    setTimeout(initCityMap, 300);
    return;
  }

  cityMapObj = L.map('city-map-leaflet', { zoomControl: false }).setView(
    [CONFIG.hotelCoords.lat, CONFIG.hotelCoords.lng], 16
  );

  // CartoDB Voyager — clean, minimal tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(cityMapObj);

  // Hotel marker — distinctive star in dark circle
  const hotelIcon = L.divIcon({
    className: '',
    html: `<div style="width:38px;height:38px;background:#2c1f14;border:3px solid #f5edd8;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,0.45);">${_icon('star', 20, '#f5edd8')}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
  L.marker([CONFIG.hotelCoords.lat, CONFIG.hotelCoords.lng], { icon: hotelIcon, zIndexOffset: 1000 })
    .addTo(cityMapObj)
    .bindTooltip(CONFIG.hotelName || 'Hotel', { permanent: false });

  // Move zoom control to bottom-right, away from overlays
  L.control.zoom({ position: 'bottomright' }).addTo(cityMapObj);

  if (poisData) addPoiMarkersToMap();

  cityMapInited = true;

  // Ensure correct size after CSS has rendered
  setTimeout(() => cityMapObj.invalidateSize(), 80);
}

function addPoiMarkersToMap() {
  if (!cityMapObj || !poisData) return;
  setHidden('poi-loading-hint', true);

  poiMarkers = []; // reset

  poisData.forEach((poi, idx) => {
    if (!poi.coords) return;
    const icon = createPoiIcon(poi.category);
    const marker = L.marker([poi.coords.lat, poi.coords.lng], { icon })
      .addTo(cityMapObj)
      .on('click', () => showPoiMiniCard(idx));
    poiMarkers.push({ marker, poi, idx });
  });

  buildMapFilterChips();
}

// Build category filter chips from loaded POI data
function buildMapFilterChips() {
  const bar = document.getElementById('map-filter-bar');
  if (!bar || !poisData) return;

  const cats = [...new Set(
    poisData.filter(p => p.category).map(p => p.category)
  )].sort();

  bar.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = 'map-filter-chip active';
  allChip.textContent = '✦ All';
  allChip.onclick = () => filterMapPois(null);
  bar.appendChild(allChip);

  cats.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'map-filter-chip';
    chip.innerHTML = _icon(_categoryIcon(cat), 14) + '\u2009' + escHtml(cat);
    chip.dataset.cat = cat;
    chip.onclick = () => filterMapPois(cat);
    bar.appendChild(chip);
  });
}

// Show/hide POI markers by category; open list panel for non-All filters
function filterMapPois(category) {
  // Update chip active state
  document.querySelectorAll('.map-filter-chip').forEach(chip => {
    const isAll = !chip.dataset.cat;
    chip.classList.toggle('active', category ? chip.dataset.cat === category : isAll);
  });

  // Show/hide markers
  poiMarkers.forEach(({ marker, poi }) => {
    const visible = !category || poi.category === category;
    if (visible  && !cityMapObj.hasLayer(marker)) cityMapObj.addLayer(marker);
    if (!visible &&  cityMapObj.hasLayer(marker)) cityMapObj.removeLayer(marker);
  });

  // Close mini-card
  const mc = document.getElementById('poi-mini-card');
  if (mc) mc.classList.remove('visible');
  currentPoi = null;

  // Open category panel for specific category; close for "All"
  if (category) {
    openMapCategoryPanel(category);
  } else {
    closeMapCategoryPanel();
  }
}

function openMapCategoryPanel(category) {
  const panel    = document.getElementById('map-category-panel');
  const titleEl  = document.getElementById('map-cat-panel-title');
  const listEl   = document.getElementById('map-cat-panel-list');
  if (!panel || !titleEl || !listEl) return;

  titleEl.innerHTML = _icon(_categoryIcon(category), 18) + '\u2009' + escHtml(category);

  const items = poiMarkers.filter(({ poi }) => poi.category === category);

  listEl.innerHTML = items.length
    ? items.map(({ poi, idx }) => `
        <div class="map-cat-panel-item" onclick="panToPoiAndShowCard(${idx})">
          <div class="map-cat-panel-icon">${_icon(_categoryIcon(poi.category), 20)}</div>
          <div class="map-cat-panel-item-info">
            <div class="map-cat-panel-item-name">${escHtml(poi.name)}</div>
            <div class="map-cat-panel-item-meta">${[poi.dist, poi.visit].filter(Boolean).join(' \u00b7 ') || ''}</div>
          </div>
          <div class="map-cat-panel-item-arrow">\u203a</div>
        </div>
      `).join('')
    : '<p style="padding:16px 24px;color:var(--text-muted);font-size:14px;">No places found.</p>';

  requestAnimationFrame(() => panel.classList.add('visible'));
}

function closeMapCategoryPanel() {
  const panel = document.getElementById('map-category-panel');
  if (panel) panel.classList.remove('visible');
}

// Tap on a list item — pan map to marker, show mini-card
function panToPoiAndShowCard(idx) {
  closeMapCategoryPanel();
  const entry = poiMarkers.find(m => m.idx === idx);
  if (!entry) return;

  if (cityMapObj && entry.poi.coords) {
    cityMapObj.setView([entry.poi.coords.lat, entry.poi.coords.lng], 17, { animate: true });
  }

  // Small delay so pan completes before card appears
  setTimeout(() => showPoiMiniCard(idx), 280);
}

function showPoiMiniCard(idx) {
  const poi = poisData ? poisData[idx] : null;
  if (!poi) return;
  currentPoi = poi;
  setText('poi-mini-category', poi.category);
  setText('poi-mini-name', poi.name);
  const meta = [poi.dist, poi.visit].filter(Boolean).join(' \u00b7 ');
  setText('poi-mini-info', meta);
  // Highlight the tapped marker
  setSelectedPoiMarker(idx);
  // Ensure category panel is hidden so cards don't overlap
  closeMapCategoryPanel();
  const el = document.getElementById('poi-mini-card');
  if (el) requestAnimationFrame(() => el.classList.add('visible'));
}

function closePoisMiniCard() {
  const el = document.getElementById('poi-mini-card');
  if (el) el.classList.remove('visible');
  // Reset marker highlight
  setSelectedPoiMarker(null);
  currentPoi = null;
}

function openPoiDetail() {
  if (!currentPoi) return;
  _populatePoiDetail(currentPoi);
  pushScreen('poi-detail');
}

function _populatePoiDetail(poi) {
  setText('poi-category', poi.category);
  setText('poi-name', poi.name);

  // Meta line: pin distance  ·  clock visit duration
  const parts = [];
  if (poi.dist)  parts.push(_icon('map-pin', 14) + ' ' + poi.dist);
  if (poi.visit) parts.push(_icon('clock', 14) + ' ' + poi.visit);
  const metaEl = document.getElementById('poi-meta');
  if (metaEl) metaEl.innerHTML = parts.join('<span style="opacity:0.4;padding:0 6px;">·</span>');

  setText('poi-short-desc', poi.shortDesc);
  setText('poi-long-desc', poi.longDesc);
  const navBtn = document.getElementById('poi-nav-btn');
  if (navBtn) navBtn.href = poi.nav || '#';

  // Hero — category-based gradient placeholder (swap with real image when available)
  const hero = document.getElementById('poi-detail-hero');
  if (hero) {
    const gradients = {
      'History':      'linear-gradient(135deg, #2a1a0e 0%, #4a2c10 100%)',
      'Food & Drink': 'linear-gradient(135deg, #1a2a0e 0%, #2d4a15 100%)',
      'Beaches':      'linear-gradient(135deg, #0e2040 0%, #1040a0 60%, #20a0c0 100%)',
      'Nature':       'linear-gradient(135deg, #0e2a10 0%, #1e4a20 100%)',
      'Nightlife':    'linear-gradient(135deg, #1a0e2a 0%, #3a1060 100%)',
      'Shopping':     'linear-gradient(135deg, #2a1a10 0%, #50301a 100%)',
      'Culture':      'linear-gradient(135deg, #1a1020 0%, #3a2050 100%)',
    };
    hero.style.background = gradients[poi.category] || 'linear-gradient(135deg, #1a1a2e 0%, #2e2e4a 100%)';
    // Category label overlaid on gradient/photo
    hero.innerHTML = poi.category
      ? `<div class="poi-hero__label">${escHtml(poi.category)}</div>`
      : '';
  }
}

// Opens an external URL reliably in PWA standalone mode on iOS/Android.
// window.open() is blocked by some mobile browsers when called from a non-direct
// user gesture context; a programmatically clicked anchor is more reliable.
function _openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function navigateToPoi() {
  if (currentPoi && currentPoi.nav) _openExternal(currentPoi.nav);
}

function popToMap() {
  // Pop back until we reach city-map or route-map context
  // Simple approach: pop once
  popScreen();
}

// ── Routes ────────────────────────────────────────────────────────────────
function renderRoutesList() {
  const container = document.getElementById('routes-list');
  if (!container) return;
  if (!routesData) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:16px 0;">Loading routes\u2026</p>';
    return;
  }
  if (!routesData.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:16px 0;">No routes available at this time.</p>';
    return;
  }

  // Group routes by type/category for premium section headers
  const groups = [];
  const seen   = new Map(); // type \u2192 group index
  routesData.forEach((r, i) => {
    const cat = r.type || '';
    if (!seen.has(cat)) {
      seen.set(cat, groups.length);
      groups.push({ cat, routes: [] });
    }
    groups[seen.get(cat)].routes.push({ r, i });
  });

  let html = '';
  groups.forEach(({ cat, routes }) => {
    // Category hero banner
    const meta = ROUTE_CATEGORY_META[cat] || {};
    const cls  = meta.cls || 'route-cat-hero--default';
    const sub  = meta.sub || (cat ? 'Curated routes in this category.' : 'Curated walks from Antique Split.');
    const title = cat || 'Routes';
    html += `
      <div class="route-cat-hero ${escHtml(cls)}">
        <div class="route-cat-hero__content">
          <p class="route-cat-hero__tag">Route Category</p>
          <h3 class="route-cat-hero__title">${escHtml(title)}</h3>
          <p class="route-cat-hero__sub">${escHtml(sub)}</p>
        </div>
      </div>`;
    // Route items for this category
    html += `<div class="section-list" style="margin-bottom:4px;">`;
    routes.forEach(({ r, i }) => {
      const icon = _routeIcon(r.type);
      const subParts = [];
      if (r.duration) subParts.push('\u23f1 ' + escHtml(r.duration));
      const itemSub = subParts.join(' \u00b7 ');
      html += `
        <div class="section-item" onclick="openRouteDetail(${i})">
          <span>${icon}</span>
          <span class="section-item-body">
            <span>${escHtml(r.name)}</span>
            ${itemSub ? `<span class="section-item-sub">${itemSub}</span>` : ''}
          </span>
          <span class="section-arrow">\u203a</span>
        </div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

function openRouteDetail(idx) {
  currentRoute = routesData ? routesData[idx] : null;
  if (!currentRoute) return;

  setText('route-detail-title', currentRoute.name);
  setText('route-map-title',    currentRoute.name);
  setText('route-type',         currentRoute.type     || '');
  setText('route-duration',     currentRoute.duration || '');
  setText('route-desc',         currentRoute.longDesc || '');
  setText('route-start',
    currentRoute.startPointName ? 'Start: ' + currentRoute.startPointName : '');

  // ── Populate premium detail hero ────────────────────────────────────────────
  const heroEl    = document.getElementById('route-detail-hero');
  const heroTitle = document.getElementById('route-hero-title');
  const heroSub   = document.getElementById('route-hero-sub');
  const heroTag   = document.getElementById('route-hero-tag');
  if (heroTitle) heroTitle.textContent = currentRoute.name || '';
  if (heroTag)   heroTag.textContent   = currentRoute.type || 'Route';
  if (heroSub) {
    const sub = currentRoute.shortDesc
      || (currentRoute.longDesc ? currentRoute.longDesc.slice(0, 120).trimEnd() + (currentRoute.longDesc.length > 120 ? '…' : '') : '')
      || 'Curated route experience from Antique Split.';
    heroSub.textContent = sub;
  }
  // Tint the hero gradient to match the route category if known
  if (heroEl) {
    const meta = ROUTE_CATEGORY_META[currentRoute.type || ''];
    if (meta && meta.cls) {
      heroEl.className = 'screen-hero screen-hero--route-detail';
      // Subtle: apply category-matched tint via inline style override
      // (real per-route images will replace this later)
    }
  }

  // POI list — route.poiIds are Airtable record IDs; look up in poisData
  const poisContainer = document.getElementById('route-pois-list');
  if (poisContainer) {
    const localPois = poisData || [];
    const routePois = (currentRoute.poiIds || [])
      .map(id => localPois.find(p => p.id === id))
      .filter(Boolean);
    poisContainer.innerHTML = routePois.length
      ? routePois.map((p, idx) => `
          <div class="section-item" onclick="openPoiFromRoute('${escHtml(p.id)}')">
            <div class="stop-info">
              <span class="stop-name">${escHtml(p.name)}</span>
              ${p.visit ? `<span class="stop-walk"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M9 22l1.5-6L8 13l2-5"/><path d="M15 22l-1.5-6 2.5-3-2-5"/><path d="M6 11l2-2 4 1 2-2"/></svg>${escHtml(p.visit)}</span>` : ''}
            </div>
            <span class="section-arrow">\u203a</span>
          </div>
        `).join('')
      : '<p style="color:var(--text-muted);font-size:14px;padding:12px 0;">No stops listed for this route.</p>';
  }

  // Profile
  const profileEl = document.getElementById('route-profile');
  if (profileEl) {
    profileEl.textContent = currentRoute.profile || '';
    profileEl.hidden = !currentRoute.profile;
  }

  pushScreen('route-detail');
}

function openPoiFromRoute(poiId) {
  const poi = (poisData || []).find(p => p.id === poiId);
  if (!poi) return;
  currentPoi = poi;
  _populatePoiDetail(poi);
  pushScreen('poi-detail');
}

function openRouteMap() {
  pushScreen('route-map');
  setTimeout(() => initRouteMap(), 120);
}

function initRouteMap() {
  const el = document.getElementById('route-map-leaflet');
  if (!el || typeof L === 'undefined' || !currentRoute) return;

  if (routeMapObj) {
    routeMapObj.remove();
    routeMapObj = null;
  }

  const startCoords = currentRoute.startPointCoords || CONFIG.hotelCoords;
  routeMapObj = L.map('route-map-leaflet').setView([startCoords.lat, startCoords.lng], 14);

  // CartoDB Voyager — consistent with city map
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(routeMapObj);

  // Start marker — hotel star
  const startIcon = L.divIcon({
    className: '',
    html: `<div style="width:32px;height:32px;background:#2c1f14;border:2.5px solid #f5edd8;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.35);">${_icon('star', 16, '#f5edd8')}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
  L.marker([startCoords.lat, startCoords.lng], { icon: startIcon })
    .addTo(routeMapObj)
    .bindTooltip('Start: ' + (currentRoute.startPointName || ''), { permanent: false });

  // Route POI markers — look up from live poisData
  const routePois = (currentRoute.poiIds || [])
    .map(id => (poisData || []).find(p => p.id === id))
    .filter(Boolean);

  routePois.forEach((poi, i) => {
    if (!poi.coords) return;
    const poiIcon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;background:#8b6914;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.2);">${i + 1}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([poi.coords.lat, poi.coords.lng], { icon: poiIcon })
      .addTo(routeMapObj)
      .bindTooltip(poi.name);
  });

  // Legend
  const legend = document.getElementById('route-map-legend');
  if (legend) {
    legend.innerHTML = routePois.map((p, i) => `
      <div style="font-size:13px;display:flex;gap:8px;align-items:center;padding:4px 0;">
        <span style="width:20px;height:20px;background:#8b6914;color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">${i + 1}</span>
        <span>${escHtml(p.name)}</span>
      </div>
    `).join('');
  }

  setTimeout(() => routeMapObj.invalidateSize(), 150);
}

function navigateToRouteStart() {
  const coords = currentRoute?.startPointCoords || CONFIG.hotelCoords;
  _openExternal(`https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`);
}

// ── Near Me ───────────────────────────────────────────────────────────────
const NM_CATEGORIES = [
  { id: 'landmarks',   label: 'Landmarks',          icon: 'landmark',     query: 'landmarks+historic+sites' },
  { id: 'beach',       label: 'Beach',               icon: 'beach',        query: 'beach' },
  { id: 'pharmacy',    label: 'Pharmacy',             icon: 'pill',         query: 'pharmacy' },
  { id: 'atm',         label: 'ATM',                  icon: 'credit-card',  query: 'ATM' },
  { id: 'supermarket', label: 'Supermarket',          icon: 'cart',         query: 'supermarket' },
  { id: 'transport',   label: 'Ferry / Bus / Taxi',   icon: 'bus',          query: 'ferry+bus+stop+taxi' },
];

function openNearMeCategory(catId) {
  const cat = NM_CATEGORIES.find(c => c.id === catId);
  if (!cat) return;
  currentNmCat = cat;
  setText('nm-category-title', cat.label);
  renderNearMeResults(cat);
  pushScreen('near-me-results');
}

function renderNearMeResults(cat) {
  const container = document.getElementById('nm-results-list');
  if (!container) return;
  const { lat, lng } = CONFIG.hotelCoords;
  const mapsUrl = `https://www.google.com/maps/search/${cat.query}/@${lat},${lng},16z`;
  container.innerHTML = `
    <div class="nm-maps-result">
      <p class="screen-subtitle">Nearest ${escHtml(cat.label.toLowerCase())} near the hotel.</p>
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="action-btn action-btn--primary action-btn--block">
        Open in Google Maps
      </a>
    </div>
  `;
}

// ── Help ──────────────────────────────────────────────────────────────────
function showRequestScreen() {
  resetRequestForm();
  pushScreen('request');
}

// ── Ask Olly chips ────────────────────────────────────────────────────────
function onChipClick(text) {
  const input = document.getElementById('ask-input');
  if (!input) return;
  input.value = text;
  onAskInput();
  // Submit immediately — chip tap = instant send
  submitAsk();
}

// ── Request form state ────────────────────────────────────────────────────
let selectedCategory = '';
let selectedPriority = 'Normal';
let requestMode      = 'request'; // 'request' | 'issue'

const COPY = {
  request: {
    title:           'Send a Request',
    catLabel:        'What do you need?',
    msgLabel:        'Describe your request',
    placeholder:     'Tell us what you need...',
    submit:          'Send Request',
    successHeading:  'Request sent',
    successText:     'Reception has been notified and will take care of it shortly.',
  },
  issue: {
    title:           'Report an Issue',
    catLabel:        'What type of issue?',
    msgLabel:        'Describe the issue',
    placeholder:     'Tell us what happened...',
    submit:          'Report Issue',
    successHeading:  'Issue reported',
    successText:     'Reception has been notified and will look into this right away.',
  },
};

function updateReqCopy() {
  const c = COPY[requestMode];
  setText('req-screen-title',    c.title);
  setText('req-cat-label',       c.catLabel);
  setText('req-msg-label',       c.msgLabel);
  setText('req-submit-btn',      c.submit);
  setText('req-success-heading', c.successHeading);
  setText('req-success-text',    c.successText);
  const msgEl = document.getElementById('req-message');
  if (msgEl) msgEl.placeholder = c.placeholder;
}

function showIssueScreen() {
  resetRequestForm();         // resets requestMode = 'request' first
  requestMode = 'issue';      // override AFTER reset
  selectCategory('Issue / Complaint');
  updateReqCopy();
  pushScreen('request');
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
  requestMode      = 'request';
  updateReqCopy();

  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('cat-btn--selected'));
  const pn = document.getElementById('prio-normal');
  const pu = document.getElementById('prio-urgent');
  if (pn) pn.classList.add('prio-btn--selected');
  if (pu) pu.classList.remove('prio-btn--selected');

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
  setHidden('req-form',    view !== 'form');
  setHidden('req-loading', view !== 'loading');
  setHidden('req-success', view !== 'success');
}

// ── Submit request ────────────────────────────────────────────────────────
async function submitRequest() {
  if (!TOKEN) {
    const errEl = document.getElementById('submit-error');
    if (errEl) {
      errEl.textContent = 'Your room link is incomplete. Please scan the QR code in your room again.';
      show('submit-error');
    }
    return;
  }

  let valid = true;

  if (!selectedCategory) {
    show('cat-error');
    valid = false;
  }

  const msgEl   = document.getElementById('req-message');
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
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-request', {
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

    showReqView('form');
    const errEl = document.getElementById('submit-error');
    if (errEl) {
      errEl.textContent = errorMessage(res.status, data.error);
      show('submit-error');
    }

  } catch (_) {
    showReqView('form');
    const errEl = document.getElementById('submit-error');
    if (errEl) {
      errEl.textContent = 'Unable to connect. Please check your connection or contact Reception directly.';
      show('submit-error');
    }
  }
}

function errorMessage(status) {
  if (status === 403) return 'Your room link has expired. Please scan the QR code in your room again.';
  if (status === 400) return 'Some required information is missing. Please check the form and try again.';
  return 'Something went wrong. Please try again or contact Reception directly.';
}

// ── Chat (Ask Dioclea) — full conversation UI ─────────────────────────────
let askInFlight  = false;
let chatMessages = [];   // [{ role: 'user'|'assistant', text: string }]

function _chatMessagesEl()  { return document.getElementById('chat-messages'); }
function _chatEmptyEl()     { return document.getElementById('chat-empty');    }
function _chatClearBtnEl()  { return document.getElementById('chat-clear-btn');}

// Append a message bubble to the chat
function _appendChatBubble(role, text) {
  const container = _chatMessagesEl();
  if (!container) return null;

  // Hide empty state on first message
  const empty = _chatEmptyEl();
  if (empty) empty.hidden = true;

  // Show clear button once there's content
  const clearBtn = _chatClearBtnEl();
  if (clearBtn) clearBtn.hidden = false;

  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg--' + role;

  const safeText = escHtml(text).replace(/\n/g, '<br>');

  if (role === 'assistant') {
    el.innerHTML =
      '<div class="chat-msg-avatar">✦</div>' +
      '<div class="chat-msg-bubble">' + safeText + '</div>';
  } else {
    el.innerHTML = '<div class="chat-msg-bubble">' + safeText + '</div>';
  }

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

// Show bouncing-dots typing indicator
function _showTypingIndicator() {
  const container = _chatMessagesEl();
  if (!container) return;
  _removeTypingIndicator();  // ensure no duplicate

  const el = document.createElement('div');
  el.id = 'chat-typing';
  el.className = 'chat-msg chat-msg--assistant chat-msg--typing';
  el.innerHTML =
    '<div class="chat-msg-avatar">✦</div>' +
    '<div class="chat-msg-bubble">' +
      '<span class="typing-dot"></span>' +
      '<span class="typing-dot"></span>' +
      '<span class="typing-dot"></span>' +
    '</div>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function _removeTypingIndicator() {
  const el = document.getElementById('chat-typing');
  if (el) el.remove();
}

function clearChat() {
  chatMessages = [];
  askInFlight = false;
  _removeTypingIndicator();

  const container = _chatMessagesEl();
  if (container) {
    // Remove all message bubbles, keep empty state div
    Array.from(container.children).forEach(ch => {
      if (ch.id !== 'chat-empty') ch.remove();
    });
  }

  const empty = _chatEmptyEl();
  if (empty) empty.hidden = false;

  const clearBtn = _chatClearBtnEl();
  if (clearBtn) clearBtn.hidden = true;

  const input = document.getElementById('ask-input');
  if (input) { input.value = ''; input.disabled = false; }

  const btn = document.getElementById('ask-btn');
  if (btn) btn.disabled = true;
}

function resetAskScreen() {
  // Called on navigation — keep chat history in-session, just unlock the input
  askInFlight = false;
  const input = document.getElementById('ask-input');
  if (input) { input.disabled = false; }
  const btn = document.getElementById('ask-btn');
  if (btn) btn.disabled = !(input && input.value.trim());
  _removeTypingIndicator();
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
  if (askInFlight) return;
  const input    = document.getElementById('ask-input');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  if (!TOKEN) {
    _appendChatBubble('assistant',
      'Your room link is incomplete. Please scan the QR code in your room again.');
    return;
  }

  // Lock input, capture question, clear field
  askInFlight = true;
  const btn = document.getElementById('ask-btn');
  if (input) { input.value = ''; input.disabled = true; }
  if (btn)   btn.disabled = true;

  // Add user bubble immediately
  chatMessages.push({ role: 'user', text: question });
  _appendChatBubble('user', question);

  // Show typing indicator while waiting
  _showTypingIndicator();

  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN, question }),
    });
    const data = await res.json().catch(() => ({}));

    _removeTypingIndicator();

    const answer = (res.ok && data.ok && data.answer)
      ? data.answer
      : _askErrorText(res.status);

    chatMessages.push({ role: 'assistant', text: answer });
    _appendChatBubble('assistant', answer);

  } catch (_) {
    _removeTypingIndicator();
    const msg = 'Unable to connect. Please check your connection and try again.';
    chatMessages.push({ role: 'assistant', text: msg });
    _appendChatBubble('assistant', msg);
  } finally {
    askInFlight = false;
    if (input) {
      input.disabled = false;
      input.focus();
      onAskInput();
    }
  }
}

function _askErrorText(status) {
  if (status === 403) return 'Your room link has expired. Please scan the QR code in your room again.';
  if (status === 501) return 'Our assistant is temporarily unavailable. Please contact Reception for help.';
  if (status === 400) return 'Your question could not be processed. Please try rephrasing it.';
  return 'Something went wrong. Please try again or contact Reception directly.';
}

// Legacy alias — kept in case any other code calls this
function askErrorMessage(status) { return [_askErrorText(status), false]; }

// ── API loaders ───────────────────────────────────────────────────────────
async function fetchWelcomeData() {
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-welcome', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    // Room type — show on splash + home header
    if (data.roomType) {
      setText('splash-room-type', data.roomType);
      setText('wh-room-type', data.roomType);
      show('wh-sep');
      // V2 room strip
      setText('v2-rtype-display', data.roomType);
      const v2Sep = document.getElementById('v2-sep-rtype');
      if (v2Sep) v2Sep.style.display = '';
    }
    // Store Google Review URL for feedback screen
    if (data.googleReviewUrl) {
      GOOGLE_REVIEW_URL = data.googleReviewUrl;
    }
  } catch (_) {
    // Silent fallback
  }
}

async function loadRoomGuide() {
  if (!ROOM || !TOKEN) return;
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-room-guide', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      roomGuideData = data;
      if (currentScreen === 'room-guide') renderRoomGuideSections();
    }
  } catch (_) {
    // Silent fallback
  }
}

async function loadServices() {
  if (!ROOM || !TOKEN) return;
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-services', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      servicesData = data.services || [];
      if (currentScreen === 'services') renderServicesList();
    }
  } catch (_) {
    // Silent fallback
  }
}

async function loadPois() {
  if (!ROOM || !TOKEN) return;
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-pois', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.pois)) {
      poisData = data.pois;
      addPoiMarkersToMap();   // no-op if map not yet inited; called again from initCityMap
      _v2RenderStepsFromDoor();
    }
  } catch (_) {
    // Silent fallback
  }
}

async function loadRoutes() {
  if (!ROOM || !TOKEN) return;
  try {
    const res  = await fetch((CONFIG.apiBase || '') + '/api/pwa-routes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split', room: ROOM, token: TOKEN }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && Array.isArray(data.routes)) {
      routesData = data.routes;
      // Re-render routes list if it's already showing
      if (currentScreen === 'routes') renderRoutesList();
    }
  } catch (_) {
    // Silent fallback
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────
function hide(id)             { const el = document.getElementById(id); if (el) el.hidden = true;  }
function show(id)             { const el = document.getElementById(id); if (el) el.hidden = false; }
function setHidden(id, state) { const el = document.getElementById(id); if (el) el.hidden = state; }
function setText(id, text)    { const el = document.getElementById(id); if (el) el.textContent = text; }

// Strip all URLs from a text string
function _stripUrls(text) {
  return (text || '').replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
}

// Extract first URL from text, optionally skipping domains in the exclude list
function _extractFirstUrl(text, excludeDomains = []) {
  const matches = (text || '').match(/https?:\/\/[^\s]+/g) || [];
  return matches.find(u => !excludeDomains.some(d => u.includes(d))) || null;
}

// Lightweight markdown → HTML renderer for service descriptions.
// Supports: **bold**, *italic*, - bullet lists, --- separator, paragraphs.
function _renderMarkdown(text) {
  if (!text) return '';

  // Split into blocks by double newline (paragraphs / list groups)
  const blocks = text.split(/\n{2,}/);

  return blocks.map(block => {
    const lines = block.split('\n');

    // Bullet list block — lines starting with - • * or digits
    const isList = lines.every(l => /^\s*([-•*]|\d+\.)\s/.test(l.trim()) || l.trim() === '');
    if (isList && lines.some(l => l.trim())) {
      const items = lines
        .filter(l => l.trim())
        .map(l => `<li>${_inlineMarkdown(l.replace(/^\s*([-•*]|\d+\.)\s*/, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(block.trim())) return '<hr>';

    // Regular paragraph — join lines with <br> for single newlines
    const html = lines.map(l => _inlineMarkdown(l)).join('<br>');
    return `<p>${html}</p>`;
  }).join('');
}

function _inlineMarkdown(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ── Boot ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

function _wmoIcon(code) {
  if (code === 0)               return _icon('w-sun',       20, '#f5c842');
  if (code <= 2)                return _icon('w-cloud-sun', 20, '#c9a227');
  if (code <= 3)                return _icon('w-cloud',     20, '#a0aab4');
  if (code <= 48)               return _icon('w-fog',       20, '#a0aab4');
  if (code <= 57)               return _icon('w-rain',      20, '#7ab0d0');
  if (code <= 67)               return _icon('w-rain',      20, '#5090b0');
  if (code <= 77)               return _icon('w-snow',      20, '#c0d8f0');
  if (code <= 82)               return _icon('w-rain',      20, '#7ab0d0');
  if (code <= 86)               return _icon('w-snow',      20, '#c0d8f0');
  return _icon('w-storm', 20, '#9080c0');
}

function renderWeatherForecast(daily) {
  const strip = document.getElementById('wf-strip');
  if (!strip || !daily?.time?.length) return;

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  strip.innerHTML = daily.time.map((dateStr, i) => {
    const d        = new Date(dateStr + 'T12:00:00');
    const label    = i === 0 ? 'Today' : DAY_NAMES[d.getDay()];
    const icon     = _wmoIcon(daily.weathercode[i]);
    const maxT     = Math.round(daily.temperature_2m_max[i]);
    const minT     = Math.round(daily.temperature_2m_min[i]);
    const todayCls = i === 0 ? ' wf-day--today' : '';
    return `<div class="wf-day${todayCls}">
      <div class="wf-label">${label}</div>
      <div class="wf-icon">${icon}</div>
      <div class="wf-max">${maxT}°</div>
      <div class="wf-min">${minT}°</div>
    </div>`;
  }).join('');

  show('wf-strip');
}

async function fetchSplitTemperature() {
  try {
    const res  = await fetch(
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=43.5081&longitude=16.4402' +
      '&current=temperature_2m' +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min' +
      '&timezone=Europe%2FZagreb&forecast_days=5'
    );
    const data = await res.json();

    // Current temperature (V1 legacy)
    const temp = Math.round(data?.current?.temperature_2m);
    if (!isNaN(temp)) {
      setText('wh-temp', temp + '°C');
      show('wh-weather');
    }

    // 5-day forecast strip (V1 legacy)
    if (data?.daily) renderWeatherForecast(data.daily);

    // V2 weather pill
    const wcode = data?.daily?.weathercode?.[0];
    const condStr = _v2WmoCondition(wcode);
    if (!isNaN(temp)) {
      setText('v2-temp', temp + '°');
      const condEl = document.getElementById('v2-wx-cond');
      if (condEl) condEl.textContent = condStr;
      const iconEl = document.getElementById('v2-wx-icon');
      if (iconEl) {
        const use = iconEl.querySelector('use');
        if (use) use.setAttribute('href', '#' + _v2WmoIconId(wcode));
      }
      // Re-render Split Today with live weather context
      _v2RenderSplitToday(condStr, temp);
      // Update weather badge on events screen if already open
      _v2UpdateEventsWeatherBadge(condStr, temp);
    }
    if (data?.daily) {
      const max0 = Math.round(data.daily.temperature_2m_max[0]);
      const min0 = Math.round(data.daily.temperature_2m_min[0]);
      const hlEl = document.getElementById('v2-wx-hl');
      if (hlEl) hlEl.textContent = 'H:' + max0 + ' · L:' + min0;
      _v2RenderWeatherForecast(data.daily);
    }

  } catch (_) { /* silent */ }
}

function enterApp() {
  // If we've already asked for permissions this session (or ever), skip the screen
  const alreadyAsked = localStorage.getItem('perm-asked');
  if (alreadyAsked) {
    gotoRoot('home');
    return;
  }
  // Show the friendly permissions screen
  _activateScreen('permissions');
}

async function grantPermissions() {
  localStorage.setItem('perm-asked', '1');

  // ── Location ──────────────────────────────────────────────────────────
  const locStatus = document.getElementById('perm-loc-status');
  if ('geolocation' in navigator) {
    try {
      await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      );
      if (locStatus) locStatus.textContent = '✓';
    } catch (_) {
      if (locStatus) locStatus.textContent = '—';
    }
  } else {
    if (locStatus) locStatus.textContent = '—';
  }

  // ── Notifications ─────────────────────────────────────────────────────
  const notifStatus = document.getElementById('perm-notif-status');
  if ('Notification' in window) {
    try {
      const result = await Notification.requestPermission();
      if (notifStatus) notifStatus.textContent = result === 'granted' ? '✓' : '—';
      if (result === 'granted') registerPush();
    } catch (_) {
      if (notifStatus) notifStatus.textContent = '—';
    }
  } else {
    if (notifStatus) notifStatus.textContent = '—';
  }

  // Small delay so user sees the ✓ ticks before transitioning
  setTimeout(() => gotoRoot('home'), 700);
}

function skipPermissions() {
  localStorage.setItem('perm-asked', '1');
  gotoRoot('home');
}

function boot() {
  // Splash room display
  setText('splash-room-number', ROOM || '—');
  setText('room-number',        ROOM || '—');

  // Home greeting (V1 legacy hidden element)
  setText('wh-greeting', getGreeting());

  // V2 hero
  setText('v2-greeting',         getGreeting());
  setText('v2-hotel-at',         'at ' + CONFIG.hotelName);
  setText('v2-room-display',     ROOM ? 'Room ' + ROOM : 'Room —');
  setText('v2-checkout-display', CONFIG.checkOut || '11:00');

  // Fetch temperature in background
  fetchSplitTemperature();

  // Contact screen
  const phoneLink = document.getElementById('contact-phone');
  if (phoneLink) phoneLink.href = 'tel:' + CONFIG.phone;

  const phoneDisplay = document.getElementById('phone-display');
  if (phoneDisplay) phoneDisplay.textContent = CONFIG.phone;

  const waLink = document.getElementById('contact-whatsapp');
  if (waLink) waLink.href = 'https://wa.me/' + CONFIG.whatsapp;

  const receptionNote = document.getElementById('reception-note');
  if (receptionNote) receptionNote.textContent = CONFIG.reception;

  // Near Me subtitle
  setText('nm-hotel-subtitle', 'Find places near ' + (CONFIG.hotelName || 'the hotel') + '.');

  // Info screen
  setText('info-hotel-name', CONFIG.hotelName);
  setText('info-address',    CONFIG.address    || '');
  setText('info-phone',      CONFIG.phone);
  setText('info-checkin',    CONFIG.checkIn    || '');
  setText('info-checkout',   CONFIG.checkOut   || '');

  if (!ROOM || !TOKEN) show('param-warning');

  // V2 home cards (static content, safe to render immediately)
  _v2RenderSplitToday();
  _v2RenderWhispersCard();
  _v2InitAskBubble();

  // Show splash screen first; guest taps "Enter" to proceed to home
  _activateScreen('app-splash');

  // Load per-room data in background
  if (ROOM && TOKEN) {
    fetchWelcomeData();
    loadRoomGuide();
    loadServices();
    loadPois();
    loadRoutes();
    loadPartners();
    loadSplitTodayEvents();
  }

  // Register push notifications if permission already granted (returning guest)
  if (Notification?.permission === 'granted') registerPush();

  // If opened from checkout push notification, go straight to feedback
  if (params.get('feedback') === '1' && ROOM && TOKEN) {
    // Give boot a tick to finish rendering, then open feedback
    setTimeout(() => pushScreen('feedback'), 300);
  }
}

document.addEventListener('DOMContentLoaded', boot);

// ── Split Today / Events ──────────────────────────────────────────────────

let activeEventsTab = 'today'; // 'today' | 'upcoming' | 'alwayson'

// ── Load Split Today Events from new grouped endpoint ─────────────────────────
async function loadSplitTodayEvents() {
  try {
    const r    = await fetch('/api/pwa-split-today-events');
    const data = await r.json();
    if (data.ok) {
      splitTodayEventsData = { today: data.today || [], thisWeek: data.thisWeek || [], upcoming: data.upcoming || [] };
      if (currentScreen === 'events' && activeEventsTab === 'upcoming') renderEventsList();
    }
  } catch (_) { /* silent */ }
}

// ── Legacy loadEvents (kept for openEventDetail compatibility) ─────────────────
async function loadEvents() {
  try {
    const r = await fetch('/api/pwa-events', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: SLUG || 'antique-split' }),
    });
    const data = await r.json();
    if (data.ok) {
      eventsData = data.events || [];
      if (currentScreen === 'events') renderEventsList();
    }
  } catch (_) { /* silent */ }
}

function switchEventsTab(tab, btn) {
  activeEventsTab = tab;
  // Update active tab styling
  document.querySelectorAll('.st-tab').forEach(b => b.classList.remove('st-tab--active'));
  if (btn) btn.classList.add('st-tab--active');
  renderEventsList();
}

function _formatEventDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Main render dispatcher ────────────────────────────────────────────────────
function renderEventsList() {
  const list = document.getElementById('events-list');
  if (!list) return;
  hide('events-loading');

  if (activeEventsTab === 'today') {
    _renderWeatherPicksTab(list);
  } else if (activeEventsTab === 'upcoming') {
    _renderSplitEventsTab(list);
  } else {
    _renderAlwaysOnTab(list);
  }
}

// ── Short date formatter: "Tue 10 Jun" ───────────────────────────────────────
function _v2FormatEventDateShort(dateStr) {
  if (!dateStr) return '';
  const d  = new Date(dateStr + 'T12:00:00');
  const dy = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return dy[d.getDay()] + ' ' + d.getDate() + ' ' + mo[d.getMonth()];
}

// ── Weather Picks tab — weather-aware recommended places ──────────────────────
function _renderWeatherPicksTab(list) {
  const h   = new Date().getHours();
  const tod = h < 12 ? 'morning' : (h < 17 ? 'afternoon' : 'evening');

  const wxCondEl = document.getElementById('v2-wx-cond');
  const wxTempEl = document.getElementById('v2-temp');
  const wxCond   = (wxCondEl && wxCondEl.textContent.trim() && wxCondEl.textContent.trim() !== ' ') ? wxCondEl.textContent.trim() : '';
  const wxTempN  = wxTempEl ? parseInt(wxTempEl.textContent) : NaN;

  const c       = wxCond.toLowerCase();
  const isRainy = c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('storm');
  const isHot   = !isRainy && !isNaN(wxTempN) && wxTempN >= 32;
  const isSunny = !isRainy && !isHot && (c === 'clear' || c.includes('sunny'));

  let contextHtml = '';
  if (wxCond) {
    let wxNote = isRainy ? 'Rain today — best for covered and indoor sights.'
               : isHot   ? 'Very warm today — go early morning or after sunset.'
               : isSunny ? 'Sunny and pleasant — ideal for open-air walks and the Riva.'
               :            'Mild conditions — comfortable for exploring all day.';
    const tempPart = !isNaN(wxTempN) ? ', ' + wxTempN + '°' : '';
    contextHtml = `<div class="st-wx-context"><strong>${escHtml(wxCond)}${tempPart}</strong> &mdash; ${wxNote}</div>`;
  }

  const places = isRainy
    ? [
        { name: "Diocletian's Cellars",    cat: 'Underground',  dist: '70 m',   note: 'Good choice if it rains'        },
        { name: 'City Museum',             cat: 'Museum',        dist: '150 m',  note: 'Covered · all weather'          },
        { name: 'Cathedral of St Domnius', cat: 'Cathedral',     dist: '80 m',   note: 'Covered · all weather'          },
        { name: 'Meštrović Gallery',       cat: 'Art museum',    dist: '1.2 km', note: 'Indoor gallery'                 },
        { name: 'City Library',            cat: 'Culture',       dist: '600 m',  note: 'Quiet indoor option'            },
      ]
    : isHot
    ? [
        { name: 'Bačvice Beach',           cat: 'Beach',         dist: '800 m',  note: 'Better in the morning heat'     },
        { name: 'Riva Promenade',          cat: 'Waterfront',    dist: '100 m',  note: 'Sea breeze, best early morning' },
        { name: "Diocletian's Cellars",    cat: 'Underground',   dist: '70 m',   note: 'Underground and cool'           },
        { name: 'Marjan Hill',             cat: 'Nature',        dist: '1.5 km', note: 'Shaded forest paths'            },
        { name: 'Sustipan Sunset Point',   cat: 'Viewpoint',     dist: '600 m',  note: 'Easy walk from the hotel'       },
      ]
    : [
        { name: 'Peristyle',               cat: 'Roman ruins',   dist: '50 m',   note: 'Easy walk from the hotel'       },
        { name: 'Riva Promenade',          cat: 'Waterfront',    dist: '100 m',  note: 'Sunny walk along the sea'       },
        { name: 'Cathedral of St Domnius', cat: 'Cathedral',     dist: '80 m',   note: 'Best seen in morning light'     },
        { name: 'Golden Gate',             cat: 'Roman gate',    dist: '200 m',  note: 'Easy walk from the hotel'       },
        { name: tod === 'evening' ? 'Sustipan Sunset Point' : 'Bačvice Beach',
          cat:  tod === 'evening' ? 'Viewpoint'              : 'Beach',
          dist: tod === 'evening' ? '600 m'                  : '800 m',
          note: tod === 'evening' ? 'Ideal for sunset'       : 'Easy walk from the hotel' },
      ];

  const rowsHtml = places.map(p => {
    // &quot; so JSON double-quotes don't break the HTML attribute delimiter
    const safeArg = JSON.stringify(p.name).replace(/"/g, '&quot;');
    return `
    <div class="st-wp-row" onclick="_openWeatherPickPoi(${safeArg})">
      <div class="st-wp-row__body">
        <div class="st-wp-row__name">${escHtml(p.name)}</div>
        <div class="st-wp-row__note">${escHtml(p.note)}</div>
      </div>
      <div class="st-wp-row__right">
        <span class="st-wp-row__cat">${escHtml(p.cat)}</span>
        <span class="st-wp-row__dist">${p.dist}</span>
      </div>
    </div>`;
  }).join('');

  list.innerHTML = contextHtml + `<div class="st-wp-list">${rowsHtml}</div>`;
}

// ── Events tab — grouped Split Today Events ───────────────────────────────────
function _renderSplitEventsTab(list) {
  if (!splitTodayEventsData) {
    list.innerHTML = '<p class="st-empty">Loading events…</p>';
    return;
  }

  const { today, thisWeek, upcoming } = splitTodayEventsData;

  if (!today.length && !thisWeek.length && !upcoming.length) {
    list.innerHTML = '<p class="st-empty">No upcoming events are listed at the moment. Reception will be happy to suggest what is happening nearby.</p>';
    return;
  }

  function renderGroup(title, evs, emptyMsg) {
    const cardsHtml = evs.length
      ? evs.map(ev => _renderSplitEventCard(ev)).join('')
      : `<p class="st-empty-sm">${emptyMsg}</p>`;
    return `<div class="st-group"><div class="st-group-hd">${title}</div>${cardsHtml}</div>`;
  }

  list.innerHTML =
    renderGroup('Today',     today,    'No special events listed for today. Reception will be happy to suggest what is happening nearby.') +
    renderGroup('This Week', thisWeek, 'No listed events for the rest of this week.') +
    renderGroup('Upcoming',  upcoming, 'No upcoming events are listed at the moment.');
}

function _renderSplitEventCard(ev) {
  const dateLabel = ev.endDate && ev.endDate !== ev.date
    ? _v2FormatEventDateShort(ev.date) + ' – ' + _v2FormatEventDateShort(ev.endDate)
    : _v2FormatEventDateShort(ev.date);

  const metaParts = [];
  if (ev.time)     metaParts.push(`<span>${escHtml(ev.time)}</span>`);
  if (ev.location) metaParts.push(`<span>${escHtml(ev.location)}</span>`);
  const metaHtml = metaParts.join(' <span class="st2-dot">&middot;</span> ');

  const linkAttr = ev.link ? ` data-link="${escHtml(ev.link)}" onclick="_v2OpenSplitEventLink(this)"` : '';
  const cls      = ev.link ? 'st2-card' : 'st2-card st2-card--no-link';

  return `
    <div class="${cls}"${linkAttr}>
      <div class="st2-card__hd">
        ${ev.category ? `<span class="st2-card__cat">${escHtml(ev.category)}</span>` : ''}
        <span class="st2-card__date">${dateLabel}</span>
      </div>
      <div class="st2-card__name">${escHtml(ev.name)}</div>
      ${metaHtml ? `<div class="st2-card__meta">${metaHtml}</div>` : ''}
      ${ev.description ? `<div class="st2-card__desc">${escHtml(ev.description)}</div>` : ''}
      ${ev.link ? '<div class="st2-card__link">More info →</div>' : ''}
    </div>`;
}

function _v2OpenSplitEventLink(el) {
  const link = el.getAttribute('data-link');
  if (link) _openExternal(link);
}

// ── Always On tab — curated evergreen POIs from Airtable ─────────────────────
function _renderAlwaysOnTab(list) {
  // If POIs not yet loaded, show a brief loading state and trigger load
  if (!poisData) {
    list.innerHTML = '<p class="st-empty">Loading permanent highlights…</p>';
    loadPois().then(() => {
      if (activeEventsTab === 'alwayson') _renderAlwaysOnTab(list);
    }).catch(() => {});
    return;
  }

  const available = poisData
    .filter(p => p.alwaysOn)
    .sort((a, b) => {
      if (a.sortOrder && b.sortOrder) return a.sortOrder - b.sortOrder;
      if (a.sortOrder) return -1;
      if (b.sortOrder) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

  if (!available.length) {
    list.innerHTML =
      '<p class="st-ao-intro">Permanent Split highlights — worth visiting any day, in any weather.</p>' +
      '<p class="st-empty-sm">No permanent highlights available.</p>';
    return;
  }

  const rowsHtml = available.map(poi => {
    const dist = poi.dist ? `<span class="st-ao-item__dist">${escHtml(poi.dist)}</span>` : '';
    const cat  = poi.category ? `<span class="st-ao-item__cat">${escHtml(poi.category)}</span>` : '';
    const desc = poi.shortDesc || '';
    return `
    <div class="st-ao-item" onclick="_openAlwaysOnPoi('${poi.id}')">
      <div class="st-ao-item__body">
        <div class="st-ao-item__name">${escHtml(poi.name)}</div>
        ${desc ? `<div class="st-ao-item__desc">${escHtml(desc)}</div>` : ''}
      </div>
      <div class="st-ao-item__right">
        ${cat}
        ${dist}
      </div>
    </div>`;
  }).join('');

  list.innerHTML =
    '<p class="st-ao-intro">Permanent Split highlights — worth visiting any day, in any weather.</p>' +
    `<div class="st-ao-list">${rowsHtml}</div>`;
}

// Open POI detail when tapping an Always On item
function _openAlwaysOnPoi(poiId) {
  const poi = (poisData || []).find(p => p.id === poiId);
  if (!poi) { openModule('near-me'); return; }
  currentPoi = poi;
  _populatePoiDetail(poi);
  pushScreen('poi-detail');
}

// Route category metadata — title, subtitle and CSS class for each category hero.
// Category names match the "Tip rute" (route type) field values from Airtable.
// To swap in a real photo later: set --hero-img on the variant class in style.css.
const ROUTE_CATEGORY_META = {
  'Romantic Split': {
    sub: 'Quiet corners, sea views and atmospheric walks for a slower Split experience.',
    cls: 'route-cat-hero--romantic',
  },
  'Local Taste & Traditions': {
    sub: 'Food, markets and local habits that reveal the everyday character of Split.',
    cls: 'route-cat-hero--local',
  },
  'History & Heritage': {
    sub: "Palace walls, ancient streets and stories from Split's layered past.",
    cls: 'route-cat-hero--history',
  },
  'Split by Night': {
    sub: 'Evening walks, relaxed atmosphere and places that come alive after sunset.',
    cls: 'route-cat-hero--night',
  },
  'Inside the Palace': {
    sub: "A closer look at the living heart of Diocletian's Palace.",
    cls: 'route-cat-hero--palace',
  },
  'Relax & Green Split': {
    sub: 'Calmer places, seaside walks and green corners near the city centre.',
    cls: 'route-cat-hero--relax',
  },
};

// Alias map: Home card display name → canonical Airtable POI name
// Used by _openWeatherPickPoi so known naming differences don't break links.
const WEATHER_PICK_POI_ALIASES = {
  'Peristyle':                'Peristyle (Peristil)',
  'Riva Promenade':           'The Riva (Waterfront)',
  'Cathedral of St Domnius':  'Cathedral of St. Domnius',
  "Diocletian's Cellars":     'The Substructures',
  'The Substructures':        'The Substructures',
  'Golden Gate':              'The Golden Gate',
};

// Find a POI by fuzzy name match — used by Weather Picks to open POI details
function _findPoiByName(query) {
  if (!poisData || !query) return null;
  const q = query.toLowerCase().trim();
  // 1. Exact match
  let m = poisData.find(p => p.name && p.name.toLowerCase().trim() === q);
  if (m) return m;
  // 2. POI name (3+ chars) is a substring of the query
  m = poisData.find(p => p.name && p.name.length > 3 && q.includes(p.name.toLowerCase()));
  if (m) return m;
  // 3. Query is a substring of the POI name
  m = poisData.find(p => p.name && p.name.toLowerCase().includes(q));
  if (m) return m;
  // 4. First significant word (3+ chars, not a stop word) matches POI name
  const stopWords = new Set(['the', 'of', 'st', 'a', 'an', 'and', 'at', 'in']);
  const firstWord = q.split(/[\s'']+/).find(w => w.length >= 3 && !stopWords.has(w));
  if (firstWord) {
    m = poisData.find(p => p.name && p.name.toLowerCase().includes(firstWord));
    if (m) return m;
  }
  return null;
}

// Open a Weather Picks place — applies alias map then fuzzy POI lookup, fallback to near-me
function _openWeatherPickPoi(name) {
  const resolved = WEATHER_PICK_POI_ALIASES[name] || name;
  const poi = _findPoiByName(resolved);
  if (!poi) { openModule('near-me'); return; }
  currentPoi = poi;
  _populatePoiDetail(poi);
  pushScreen('poi-detail');
}

function openEventDetail(idx) {
  currentEvent = eventsData[idx];
  if (!currentEvent) return;

  // Hero icon based on event keywords
  const name = currentEvent.name.toLowerCase();
  let evIcon = 'drama';
  if (name.includes('wine') || name.includes('tasting'))                              evIcon = 'wine';
  else if (name.includes('kayak') || name.includes('swim') || name.includes('sea'))   evIcon = 'kayak';
  else if (name.includes('music') || name.includes('concert') || name.includes('festival') || name.includes('singing')) evIcon = 'music';
  else if (name.includes('food') || name.includes('market') || name.includes('beer')) evIcon = 'beer';
  else if (name.includes('palace') || name.includes('diocletian') || name.includes('history')) evIcon = 'history';
  else if (name.includes('tour'))                                                      evIcon = 'map';
  else if (name.includes('beach') || name.includes('bačvice'))                        evIcon = 'beach';
  else if (name.includes('marjan') || name.includes('hill') || name.includes('park')) evIcon = 'leaf';
  else if (name.includes('market') || name.includes('pazar'))                         evIcon = 'shopping-bag';
  else if (name.includes('riva') || name.includes('promenade'))                       evIcon = 'waves';
  else if (name.includes('night'))                                                     evIcon = 'moon';

  document.getElementById('ev-detail-hero').innerHTML = _icon(evIcon, 48, '#f5edd8');
  setText('ev-detail-name', currentEvent.name);
  setText('ev-detail-date', _formatEventDate(currentEvent.date));
  setText('ev-detail-desc', currentEvent.description);

  const linkEl = document.getElementById('ev-detail-link');
  if (currentEvent.link) {
    linkEl.href = currentEvent.link;
    show('ev-detail-link');
  } else {
    hide('ev-detail-link');
  }

  pushScreen('event-detail');
}

// ── Concierge ─────────────────────────────────────────────────────────────

async function loadPartners() {
  if (partnersData) return;
  try {
    const r = await fetch('/api/pwa-partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, room: ROOM, token: TOKEN }),
    });
    const d = await r.json();
    if (d.ok) {
      partnersData = d.partners || [];
      renderConciergeRestaurants();
    }
  } catch (e) {
    console.warn('loadPartners error', e);
  }
}

function renderConciergeRestaurants() {
  const el = document.getElementById('conc-restaurants-list');
  if (!el) return;
  if (!partnersData || !partnersData.length) {
    el.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:14px;">No partner restaurants available at this time.</div>';
    return;
  }
  el.innerHTML = partnersData.map((p, i) => `
    <div class="conc-item" onclick="openRestaurantDetail(${i})">
      <span class="conc-item-icon">${_icon('utensils')}</span>
      <div class="conc-item-body">
        <div class="conc-item-title">${escHtml(p.name)}</div>
        <div class="conc-item-sub">${[p.cuisine, p.price].filter(Boolean).map(escHtml).join(' · ')}</div>
      </div>
      <span class="section-arrow">›</span>
    </div>
  `).join('');
}

function openRestaurantDetail(idx) {
  currentPartner = partnersData ? partnersData[idx] : null;
  if (!currentPartner) return;
  const p = currentPartner;

  setText('rest-detail-title', p.name);
  setText('rest-detail-category', p.cuisine || p.category);

  // Meta badges
  const badges = [];
  if (p.price)      badges.push(`<span class="rest-badge">${_icon('dollar', 14)}&nbsp;${escHtml(p.price)}</span>`);
  if (p.atmosphere) badges.push(`<span class="rest-badge">${_icon('sparkle', 14)}&nbsp;${escHtml(p.atmosphere)}</span>`);
  const metaEl = document.getElementById('rest-detail-meta');
  if (metaEl) metaEl.innerHTML = badges.join('');

  setText('rest-detail-desc', p.description);

  // Detail info list
  const infoEl = document.getElementById('rest-detail-info');
  if (infoEl) {
    const rows = [];
    if (p.hours)   rows.push(`<div class="section-item" style="cursor:default;"><span>${_icon('clock', 16)}&nbsp;Hours</span><span style="color:var(--text-muted);font-size:14px;">${escHtml(p.hours)}</span></div>`);
    if (p.address) rows.push(`<div class="section-item" style="cursor:default;"><span>${_icon('map-pin', 16)}&nbsp;Address</span><span style="color:var(--text-muted);font-size:14px;">${escHtml(p.address)}</span></div>`);
    if (p.mapsUrl) rows.push(`<div class="section-item" onclick="_openExternal('${escHtml(p.mapsUrl)}')"><span>${_icon('map', 16)}&nbsp;Open in Maps</span><span class="section-arrow">›</span></div>`);
    infoEl.innerHTML = rows.join('') || '<div style="padding:12px 0;color:var(--text-muted);font-size:14px;">Contact reception for details.</div>';
  }

  // Hero gradient
  const hero = document.getElementById('rest-detail-hero');
  if (hero) {
    const grads = ['linear-gradient(135deg,#1a2a10 0%,#2d4a20 100%)', 'linear-gradient(135deg,#2a1010 0%,#4a2020 100%)', 'linear-gradient(135deg,#10102a 0%,#1a1a50 100%)'];
    hero.style.background = grads[idx % grads.length];
  }

  pushScreen('restaurant-detail');
}

function openRestaurantForm() {
  currentConciForm = 'restaurant';
  _buildConciergeForm('restaurant');
  pushScreen('concierge-form');
}

// type: 'taxi' | 'boat' | 'shuttle'
function openConciergeForm(type) {
  currentConciForm = type;
  currentPartner = null;
  _buildConciergeForm(type);
  pushScreen('concierge-form');
}

function _buildConciergeForm(type) {
  const titles    = { taxi: 'Taxi Request', boat: 'Boat Transfer', shuttle: 'Airport Shuttle', restaurant: 'Reserve a Table', wakeup: 'Wake-up Call' };
  const formIcons = { taxi: 'taxi', boat: 'anchor', shuttle: 'shuttle', restaurant: 'utensils', wakeup: 'alarm' };

  setText('conc-form-title', titles[type] || 'Request');

  // Hero icon
  const hero = document.getElementById('conc-form-hero');
  if (hero) hero.innerHTML = _icon(formIcons[type] || 'bell', 48, '#f5edd8');

  // Extra fields depending on type
  const fieldsEl = document.getElementById('conc-form-fields');
  if (!fieldsEl) return;

  if (type === 'restaurant') {
    fieldsEl.innerHTML = `
      <div class="form-group">
        <label class="form-label">Restaurant</label>
        <input type="text" id="conc-partner" class="form-input" value="${currentPartner ? escHtml(currentPartner.name) : ''}" readonly>
      </div>`;
  } else if (type === 'wakeup') {
    fieldsEl.innerHTML = ''; // date + time fields below are enough
  } else {
    fieldsEl.innerHTML = `
      <div class="form-group">
        <label class="form-label">Pickup location</label>
        <input type="text" id="conc-from" class="form-input" placeholder="${type === 'shuttle' ? 'e.g. Split Airport' : 'e.g. Hotel'}">
      </div>
      <div class="form-group">
        <label class="form-label">Destination</label>
        <input type="text" id="conc-to" class="form-input" placeholder="${type === 'shuttle' ? 'e.g. Hotel Antique Split' : 'e.g. Split Airport'}">
      </div>`;
  }

  // Reset common fields
  const dateEl = document.getElementById('conc-date');
  const timeEl = document.getElementById('conc-time');
  const noteEl = document.getElementById('conc-note');
  const nameEl = document.getElementById('conc-name');
  const guestsEl = document.getElementById('conc-guests');

  if (type === 'wakeup') {
    // Pre-fill date = tomorrow, label as "Wake-up date"
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateEl) { dateEl.value = tomorrow.toISOString().slice(0, 10); dateEl.required = true; }
    if (timeEl) { timeEl.value = '07:00'; timeEl.required = true; }
  } else {
    if (dateEl) { dateEl.value = ''; dateEl.required = true; }
    if (timeEl) { timeEl.value = ''; timeEl.required = true; }
  }
  if (noteEl)   noteEl.value = '';
  if (nameEl)   nameEl.value = '';
  if (guestsEl) guestsEl.value = '2';

  // Hide guests + name fields for wake-up call (not needed)
  const guestsGroup = document.getElementById('conc-group-guests');
  const nameGroup   = document.getElementById('conc-group-name');
  const isWakeup    = type === 'wakeup';
  if (guestsGroup) guestsGroup.hidden = isWakeup;
  if (nameGroup)   nameGroup.hidden   = isWakeup;
}

async function submitConciergeForm(e) {
  e.preventDefault();
  const btn = document.getElementById('conc-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  const type      = currentConciForm;
  const date      = document.getElementById('conc-date')?.value || '';
  const time      = document.getElementById('conc-time')?.value || '';
  const guests    = document.getElementById('conc-guests')?.value || '';
  const guestName = document.getElementById('conc-name')?.value || '';
  const note      = document.getElementById('conc-note')?.value || '';
  const fromLoc   = document.getElementById('conc-from')?.value || '';
  const toLoc     = document.getElementById('conc-to')?.value || '';
  const partner   = currentPartner?.name || document.getElementById('conc-partner')?.value || '';

  // Map type to Airtable Kategorija
  const categoryMap = { taxi: 'Taxi', boat: 'Boat Transfer', shuttle: 'Airport Shuttle', restaurant: 'Restaurant', wakeup: 'Wake-up Call' };
  const category = categoryMap[type] || 'Guest Services';

  // Build human-readable message summary
  const lines = [];
  if (type === 'restaurant' && partner) lines.push(`Restaurant: ${partner}`);
  if (date)    lines.push(`Date: ${date}`);
  if (time)    lines.push(`Time: ${time}`);
  if (fromLoc) lines.push(`From: ${fromLoc}`);
  if (toLoc)   lines.push(`To: ${toLoc}`);
  if (guests)  lines.push(`Guests: ${guests}`);
  if (note)    lines.push(`Note: ${note}`);
  const message = lines.join('\n') || 'No details provided.';

  try {
    const r = await fetch('/api/pwa-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: SLUG, room: ROOM, token: TOKEN,
        category,
        message,
        guestName: guestName || undefined,
        date:    date     || undefined,
        time:    time     || undefined,
        from:    fromLoc  || undefined,
        to:      toLoc    || undefined,
        guests:  guests   || undefined,
        partnerName: partner || undefined,
      }),
    });
    const d = await r.json();
    if (d.ok) {
      // Show confirmation screen
      const bodyEl = document.getElementById('req-sent-body');
      if (bodyEl) {
        const typeLabels = { taxi: 'taxi', boat: 'boat transfer', shuttle: 'airport shuttle', restaurant: 'table reservation', wakeup: 'wake-up call' };
        bodyEl.textContent = `Your ${typeLabels[type] ? typeLabels[type] + ' request' : 'request'} has been sent to reception. We'll confirm shortly.`;
      }
      pushScreen('request-sent');
    } else {
      alert('Could not send request. Please try again or contact reception.');
    }
  } catch (err) {
    alert('Network error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Request'; }
  }
}

// ── Whispers of the Palace ────────────────────────────────────────────────

let currentWhispersChapter = null; // currently open chapter object

// Gradients used as fallback when image file is missing
function _whispersGradient(chapter) {
  return chapter.gradient || 'linear-gradient(160deg, #1a0e2e 0%, #2c1f14 100%)';
}

// Apply background to a hero element: image with gradient fallback
function _applyWhispersHero(el, chapter) {
  if (!el) return;
  const img = chapter.image || '';
  if (img) {
    el.style.backgroundImage =
      `url('${img}'), ${_whispersGradient(chapter)}`;
  } else {
    el.style.backgroundImage = _whispersGradient(chapter);
  }
}

function openWhispersList() {
  renderWhispersChapterList();
  pushScreen('whispers-list');
}

function renderWhispersChapterList() {
  const container = document.getElementById('whispers-chapters-list');
  if (!container || typeof WHISPERS_CHAPTERS === 'undefined') return;

  container.innerHTML = WHISPERS_CHAPTERS.map((ch, idx) => {
    const mapLink = ch.relatedPlace
      ? `<button class="whispers-card-btn--map" onclick="event.stopPropagation();whispersOpenMap(${idx})">Map</button>`
      : '';
    return `
      <div class="whispers-chapter-card" onclick="openWhispersChapter(${idx})">
        <div class="whispers-chapter-img"
             style="background-image:url('${escHtml(ch.image)}'),${ch.gradient};"></div>
        <div class="whispers-chapter-card-content">
          <div class="whispers-chapter-number">Chapter ${escHtml(ch.number)}</div>
          <h2 class="whispers-chapter-title">${escHtml(ch.title)}</h2>
          <p class="whispers-chapter-short">${escHtml(ch.shortText)}</p>
          <div class="whispers-chapter-meta">Illustrated story &middot; 3 min read</div>
          <div class="whispers-card-actions">
            <button class="whispers-card-btn--read" onclick="event.stopPropagation();openWhispersChapter(${idx})">Read story</button>
            ${mapLink}
          </div>
        </div>
      </div>`;
  }).join('');
}

function openWhispersChapter(idx) {
  const chapter = (typeof WHISPERS_CHAPTERS !== 'undefined') ? WHISPERS_CHAPTERS[idx] : null;
  if (!chapter) return;
  currentWhispersChapter = chapter;
  _renderWhispersDetail(chapter, idx);
  pushScreen('whispers-detail');
}

function _renderWhispersDetail(ch, idx) {
  // Hero
  const heroEl = document.getElementById('whispers-detail-hero');
  if (heroEl) _applyWhispersHero(heroEl, ch);

  // Hero content (chapter number + title overlay)
  const heroContent = document.getElementById('whispers-detail-hero-content');
  if (heroContent) {
    heroContent.innerHTML = `
      <div class="whispers-detail-number">Chapter ${escHtml(ch.number)}</div>
      <h1 class="whispers-detail-title">${escHtml(ch.title)}</h1>
      <p class="whispers-detail-subtitle">${escHtml(ch.subtitle)}</p>
    `;
  }

  // Body
  const bodyEl = document.getElementById('whispers-detail-body');
  if (!bodyEl) return;

  const total = WHISPERS_CHAPTERS.length;
  const prevCh = idx > 0 ? WHISPERS_CHAPTERS[idx - 1] : null;
  const nextCh = idx < total - 1 ? WHISPERS_CHAPTERS[idx + 1] : null;

  // Main text paragraphs
  const paras = Array.isArray(ch.mainText)
    ? ch.mainText.map(p => `<p class="whispers-para">${escHtml(p)}</p>`).join('')
    : `<p class="whispers-para">${escHtml(ch.mainText || '')}</p>`;

  // Did you know box
  const didYouKnow = ch.didYouKnow
    ? `<div class="whispers-did-you-know">
        <div class="whispers-did-you-know-label">Did you know?</div>
        <p class="whispers-did-you-know-text">${escHtml(ch.didYouKnow)}</p>
       </div>`
    : '';

  // Video placeholder
  const videoBlock = `
    <div class="whispers-video-placeholder">
      ${ch.videoUrl
        ? `<video src="${escHtml(ch.videoUrl)}" controls playsinline class="whispers-video"></video>`
        : `<div class="whispers-video-empty">
             <span class="whispers-video-icon">&#9654;</span>
             <span class="whispers-video-label">${escHtml(ch.videoLabel || 'Video coming later')}</span>
           </div>`}
    </div>`;

  // Previous / Next navigation cards
  const prevCard = prevCh
    ? `<button class="whispers-nav-card whispers-nav-card--prev" onclick="openWhispersChapter(${idx - 1})">
         <span class="whispers-nav-dir">&larr; Previous</span>
         <span class="whispers-nav-chapter">${escHtml(prevCh.number)} &middot; ${escHtml(prevCh.title)}</span>
       </button>`
    : `<span class="whispers-nav-card whispers-nav-card--empty"></span>`;

  const nextCard = nextCh
    ? `<button class="whispers-nav-card whispers-nav-card--next" onclick="openWhispersChapter(${idx + 1})">
         <span class="whispers-nav-dir">Next &rarr;</span>
         <span class="whispers-nav-chapter">${escHtml(nextCh.number)} &middot; ${escHtml(nextCh.title)}</span>
       </button>`
    : `<button class="whispers-nav-card whispers-nav-card--next whispers-nav-card--last" onclick="popScreen()">
         <span class="whispers-nav-dir">All chapters</span>
         <span class="whispers-nav-chapter">Back to stories</span>
       </button>`;

  // Secondary actions
  const mapBtn = ch.relatedPlace
    ? `<button class="whispers-action-btn whispers-action-btn--map" onclick="whispersOpenMap(${idx})">
         Open ${escHtml(ch.relatedPlace)}
       </button>`
    : '';

  const backBtn = `<button class="whispers-action-btn whispers-action-btn--back" onclick="popScreen()">
    &larr; Back to stories
  </button>`;

  bodyEl.innerHTML = `
    <div class="whispers-detail">
      <div class="whispers-text-body">
        ${paras}
      </div>
      ${didYouKnow}
      ${videoBlock}
      <div class="whispers-nav">
        ${prevCard}
        ${nextCard}
      </div>
      <div class="whispers-actions whispers-actions--secondary">
        ${mapBtn}
        ${backBtn}
      </div>
    </div>
  `;
}

// Open related place on City Map (routes to city-map welcome; TODO: deep-link to POI)
function whispersOpenMap(idx) {
  const ch = (typeof WHISPERS_CHAPTERS !== 'undefined') ? WHISPERS_CHAPTERS[idx] : null;
  if (!ch || !ch.relatedPlace) return;
  // TODO: when relatedPoiKey is set and poisData is loaded, find and navigate to POI directly.
  // For now, open city-map-welcome so guest can explore.
  openCityMapWelcome();
}

// Render whispers intro hero gradient on first open
function _initWhispersIntroHero() {
  const el = document.getElementById('whispers-intro-hero');
  if (!el) return;
  // Use cover image of Ch01 as the intro hero, or fallback to a rich gradient
  const coverImg = (typeof WHISPERS_CHAPTERS !== 'undefined' && WHISPERS_CHAPTERS[0])
    ? WHISPERS_CHAPTERS[0].image
    : '';
  if (coverImg) {
    el.style.backgroundImage = `url('${coverImg}'), linear-gradient(160deg,#1a0e2e 0%,#3a1a0e 60%,#2c1f14 100%)`;
  } else {
    el.style.backgroundImage = 'linear-gradient(160deg,#1a0e2e 0%,#3a1a0e 60%,#2c1f14 100%)';
  }
}

// ── Push Notifications ────────────────────────────────────────────────────

// VAPID public key (from server)
const VAPID_PUBLIC_KEY = 'BOajhRLHtx_ppFqci-CIDwZfi28Kbc6Kj1Yk2kVlntrNzzCFwJUzjugzkFSkYX2PMeFxwfEwTGLg1QlIz6Y_LNM';

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!ROOM || !TOKEN) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Save to server
    await fetch('/api/pwa-push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, room: ROOM, token: TOKEN, subscription }),
    });
  } catch (e) {
    // User denied or browser doesn't support — silent fail
    console.info('[push] Not subscribed:', e.message);
  }
}

// ── Feedback ──────────────────────────────────────────────────────────────

function _initFeedbackStars() {
  feedbackRatings = {};
  document.querySelectorAll('.fb-stars').forEach(group => {
    const key   = group.dataset.key;
    const stars = group.querySelectorAll('.fb-star');
    stars.forEach(star => {
      star.classList.remove('fb-star--on');
      star.onclick = () => {
        const val = parseInt(star.dataset.val, 10);
        feedbackRatings[key] = val;
        stars.forEach(s => s.classList.toggle('fb-star--on', parseInt(s.dataset.val, 10) <= val));
      };
    });
  });
}

function _activateFeedbackScreen() {
  _initFeedbackStars();
  const commentEl = document.getElementById('fb-comment');
  if (commentEl) commentEl.value = '';
}

async function submitFeedback() {
  const overall = feedbackRatings['overall'];
  if (!overall) {
    alert('Please rate your overall stay before submitting.');
    return;
  }

  const btn = document.querySelector('#screen-feedback .action-btn--primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const r = await fetch('/api/pwa-feedback', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug:         SLUG || 'antique-split',
        room:         ROOM,
        token:        TOKEN,
        overall:      feedbackRatings['overall']      || null,
        room_score:   feedbackRatings['room_score']   || null,
        staff:        feedbackRatings['staff']        || null,
        location:     feedbackRatings['location']     || null,
        cleanliness:  feedbackRatings['cleanliness']  || null,
        comment:      document.getElementById('fb-comment')?.value || '',
      }),
    });
    const d = await r.json();
    if (d.ok) {
      // Set Google Review link
      const googleBtn = document.getElementById('fb-google-btn');
      if (googleBtn && GOOGLE_REVIEW_URL) {
        googleBtn.href = GOOGLE_REVIEW_URL;
        googleBtn.hidden = false;
      } else if (googleBtn) {
        googleBtn.hidden = true;
      }
      pushScreen('feedback-done');
    } else {
      alert('Could not send feedback. Please try again.');
    }
  } catch (_) {
    alert('Network error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Feedback'; }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// HOME V2 — helper functions
// ══════════════════════════════════════════════════════════════════════════════

// ── HTML escape ───────────────────────────────────────────────────────────────
function _v2Esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── WMO weather code → condition string ───────────────────────────────────────
function _v2WmoCondition(code) {
  if (code === undefined || code === null) return 'Clear';
  code = Number(code);
  if (code === 0) return 'Clear';
  if (code <= 2)  return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 84) return 'Heavy showers';
  if (code <= 94) return 'Thunderstorm';
  return 'Storm';
}

// ── WMO weather code → SVG icon id ────────────────────────────────────────────
function _v2WmoIconId(code) {
  if (code === undefined || code === null) return 'ico-sun';
  code = Number(code);
  if (code === 0) return 'ico-sun';
  if (code <= 2)  return 'ico-cloud-sun';
  if (code === 3) return 'ico-cloud';
  if (code <= 59) return 'ico-cloud';
  if (code <= 82) return 'ico-cloud-rain';
  return 'ico-cloud-rain';
}

// ── Toggle weather forecast panel ─────────────────────────────────────────────
var _v2WxOpen = false;

function v2ToggleWeather() {
  _v2WxOpen = !_v2WxOpen;
  var panel = document.getElementById('v2-wx-forecast');
  var pill  = document.getElementById('v2-wx-pill');
  var hint  = document.querySelector('.v2-wx-pill__hint span');
  if (panel) {
    panel.classList.toggle('v2-wx-forecast--open', _v2WxOpen);
    panel.setAttribute('aria-hidden', String(!_v2WxOpen));
  }
  if (pill) pill.classList.toggle('v2-wx-pill--open', _v2WxOpen);
  if (hint) hint.textContent = _v2WxOpen ? 'Collapse' : 'Tap for 5-day';
}

// ── Render 5-day forecast columns from open-meteo daily data ──────────────────
function _v2RenderWeatherForecast(daily) {
  var container = document.getElementById('v2-wx-days');
  if (!container) return;
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  container.innerHTML = daily.time.map(function (dateStr, i) {
    var d = new Date(dateStr + 'T12:00:00');
    var label    = DAY_NAMES[d.getDay()];
    var isToday  = (i === 0);
    var wrapCls  = 'v2-wx-day' + (isToday ? ' v2-wx-day--today' : '');
    var labelCls = 'v2-wx-day__label' + (isToday ? ' v2-wx-day__label--today' : '');
    var iconId   = _v2WmoIconId(daily.weathercode[i]);
    var maxT     = Math.round(daily.temperature_2m_max[i]);
    var minT     = Math.round(daily.temperature_2m_min[i]);
    return (
      '<div class="' + wrapCls + '">' +
        '<span class="' + labelCls + '">' + label + '</span>' +
        '<span class="v2-wx-day__icon">' +
          '<svg class="v2-icon v2-icon--sm"><use href="#' + iconId + '"/></svg>' +
        '</span>' +
        '<span class="v2-wx-day__temp">' + maxT + '&deg;</span>' +
        '<span class="v2-wx-day__hl">' + maxT + '&deg;&nbsp;' + minT + '&deg;</span>' +
      '</div>'
    );
  }).join('');
}

// ── Distance formatter ─────────────────────────────────────────────────────────
function _v2FormatDist(m) {
  if (!m || isNaN(m)) return '';
  m = Number(m);
  if (m < 1000) return m + ' m';
  return (m / 1000).toFixed(1).replace('.0', '') + ' km';
}

// ── POI category → gradient (Steps from your door card backgrounds) ───────────
// Covers Airtable English values: Culture, History, Religion, Square,
// Viewpoint, Waterfront, Nature, Market, Park, Street + legacy names.
var _V2_POI_GRADIENTS = {
  'History':      'linear-gradient(155deg, #2c1a0e 0%, #5c3820 55%, #3a2510 100%)',
  'Culture':      'linear-gradient(155deg, #1a1020 0%, #3a2050 100%)',
  'Religion':     'linear-gradient(155deg, #1a1428 0%, #2c2040 100%)',
  'Square':       'linear-gradient(155deg, #1c1810 0%, #3a3218 100%)',
  'Viewpoint':    'linear-gradient(155deg, #0a1824 0%, #0e2d40 100%)',
  'Waterfront':   'linear-gradient(155deg, #082030 0%, #0e3850 55%, #0a2840 100%)',
  'Nature':       'linear-gradient(155deg, #0e2a10 0%, #1e4a20 100%)',
  'Park':         'linear-gradient(155deg, #0a2010 0%, #184030 100%)',
  'Market':       'linear-gradient(155deg, #1a1000 0%, #3a2800 100%)',
  'Street':       'linear-gradient(155deg, #181818 0%, #2e2e2e 100%)',
  'Food & Drink': 'linear-gradient(155deg, #0a1a08 0%, #1c3818 100%)',
  'Beaches':      'linear-gradient(155deg, #083050 0%, #0e4870 55%, #083850 100%)',
  'Nightlife':    'linear-gradient(155deg, #1a0e2a 0%, #3a1060 100%)',
  'Shopping':     'linear-gradient(155deg, #2a1a10 0%, #50301a 100%)',
};

// ── Render Steps from your door from live poisData ─────────────────────────────
// Sort: Sort Order (non-zero first) → walking distance → name.
// Clicking a card opens that POI's detail screen directly.
function _v2RenderStepsFromDoor() {
  var scroll = document.getElementById('v2-poi-scroll');
  if (!scroll) return;
  var pois = (typeof poisData !== 'undefined' && Array.isArray(poisData)) ? poisData : [];
  if (!pois.length) return;

  // Parse leading number from dist string ("0–5 min" → 0, "5–10 min" → 5, etc.)
  function _distNum(d) {
    var m = (d || '').match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 999;
  }

  var sorted = pois.slice().sort(function (a, b) {
    var ao = (a.sortOrder && a.sortOrder > 0) ? a.sortOrder : 999;
    var bo = (b.sortOrder && b.sortOrder > 0) ? b.sortOrder : 999;
    if (ao !== bo) return ao - bo;
    var ad = _distNum(a.dist), bd = _distNum(b.dist);
    if (ad !== bd) return ad - bd;
    return (a.name || '').localeCompare(b.name || '');
  });

  scroll.innerHTML = sorted.slice(0, 10).map(function (poi) {
    var name = poi.name     || '';
    var cat  = poi.category || '';
    var dist = poi.dist     || '';
    var id   = poi.id       || '';
    var bg   = _V2_POI_GRADIENTS[cat] || 'linear-gradient(155deg, #14222d 0%, #1a3445 100%)';
    // Each card opens the specific POI detail; safe string — Airtable IDs are alphanumeric
    var clickHandler = id
      ? 'onclick="_openAlwaysOnPoi(\'' + id + '\')"'
      : 'onclick="gotoRoot(\'city-map\')"';
    return (
      '<div class="v2-poi-card" ' + clickHandler + '>' +
        '<div class="v2-poi-card__bg" style="background:' + bg + '"></div>' +
        (dist ? '<div class="v2-poi-card__dist">' + _v2Esc(dist) + '</div>' : '') +
        '<div class="v2-poi-card__body">' +
          '<div class="v2-poi-card__name">' + _v2Esc(name) + '</div>' +
          '<div class="v2-poi-card__cat">'  + _v2Esc(cat)  + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ── Render Split Today card — weather-aware ────────────────────────────────────
// wxCond: string from _v2WmoCondition()  e.g. "Clear", "Rain", "Partly cloudy"
// wxTempC: number in Celsius
function _v2RenderSplitToday(wxCond, wxTempC) {
  var card = document.getElementById('v2-today-card');
  if (!card) return;

  var h   = new Date().getHours();
  var tod = h < 12 ? 'morning' : (h < 17 ? 'afternoon' : 'evening');

  // ── Classify weather ──────────────────────────────────────────────────────
  var hasWeather = !!wxCond;
  var c = wxCond ? wxCond.toLowerCase() : '';
  var isRainy  = c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('storm');
  var isHot    = !isRainy && wxTempC !== undefined && wxTempC >= 32;
  var isSunny  = !isRainy && !isHot && (c === 'clear' || c.includes('sunny'));
  var isCloudy = hasWeather && !isRainy && !isHot && !isSunny;

  // ── Title ─────────────────────────────────────────────────────────────────
  var title;
  if (isRainy) {
    title = 'A good day for covered sights';
  } else if (isHot) {
    title = tod === 'morning' ? 'Beat the heat — go early' : 'Best after sunset today';
  } else if (isSunny) {
    title = tod === 'morning'   ? 'A perfect morning for the old town'
          : tod === 'afternoon' ? 'The old town in afternoon light'
          : 'An evening walk through history';
  } else if (isCloudy) {
    title = tod === 'morning'   ? 'A comfortable morning in the Palace'
          : tod === 'afternoon' ? 'The old town awaits this afternoon'
          : 'An evening in the heart of history';
  } else {
    // No weather yet — time-of-day fallback
    title = tod === 'morning'   ? 'A perfect morning for the old town'
          : tod === 'afternoon' ? 'The old town awaits this afternoon'
          : 'An evening in the heart of history';
  }

  // ── Subtitle ──────────────────────────────────────────────────────────────
  var sub;
  var tempPart  = (wxTempC !== undefined && !isNaN(wxTempC)) ? wxTempC + '\xb0' : '';
  var condPart  = wxCond || '';
  var condTemp  = [condPart, tempPart].filter(Boolean).join(', ');
  var prefix    = condTemp ? condTemp + ' — ' : '';

  if (isRainy) {
    sub = prefix + 'Good choice for the Cellars, museums, and covered passages.';
  } else if (isHot) {
    sub = prefix + 'Better in the morning or after dark to avoid the heat.';
  } else if (isSunny) {
    sub = prefix + 'Best for open-air sights and the Riva promenade.';
  } else if (isCloudy) {
    sub = prefix + 'Comfortable for walking the Palace District all day.';
  } else {
    var todSub = {
      morning:   'Best for open-air sights before the midday heat.',
      afternoon: 'Good for shaded passages and the Riva waterfront.',
      evening:   'The Riva and Peristyle come alive at night.',
    };
    sub = todSub[tod];
  }

  // ── POIs — swap for rainy weather ─────────────────────────────────────────
  var staticPois = isRainy
    ? [
        { name: "Diocletian's Cellars",    dist: '70 m'  },
        { name: 'City Museum',             dist: '150 m' },
        { name: 'Cathedral of St Domnius', dist: '80 m'  },
      ]
    : [
        { name: 'Peristyle',               dist: '50 m'  },
        { name: 'Riva Promenade',          dist: '100 m' },
        { name: 'Cathedral of St Domnius', dist: '80 m'  },
      ];

  var poisHtml = staticPois.map(function (p) {
    // JSON.stringify for apostrophe safety; &quot; so double-quotes don't break the HTML attribute
    var safeArg = JSON.stringify(p.name).replace(/"/g, '&quot;');
    return (
      '<div class="v2-today-poi-row" onclick="_openWeatherPickPoi(' + safeArg + ')">' +
        '<div class="v2-today-poi-dot"></div>' +
        '<div class="v2-today-poi-name">' + _v2Esc(p.name) + '</div>' +
        '<div class="v2-today-poi-dist">' + p.dist + '</div>' +
      '</div>'
    );
  }).join('');

  card.innerHTML =
    '<div class="v2-today-hd">' +
      '<span class="v2-today-tag">Split Today &middot; Weather Picks</span>' +
      '<button class="v2-today-see-all" onclick="openModule(\'events\')">' +
        'See all <svg class="v2-icon v2-icon--xs"><use href="#ico-arrow-right"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="v2-today-mood">' +
      '<div class="v2-today-mood__title">' + _v2Esc(title) + '</div>' +
      '<div class="v2-today-mood__sub">' + sub + '</div>' +
    '</div>' +
    '<div class="v2-today-pois">' + poisHtml + '</div>';
}

// ── Render Whispers of the Palace card ────────────────────────────────────────
function _v2RenderWhispersCard() {
  var card = document.getElementById('v2-whispers-card');
  if (!card) return;
  card.innerHTML =
    '<div class="v2-whispers-badge">' +
      '<svg class="v2-icon v2-icon--xs"><use href="#ico-book-open"/></svg>' +
      ' Cultural Series' +
    '</div>' +
    '<div class="v2-whispers-title">Whispers of the Palace</div>' +
    '<div class="v2-whispers-sub">' +
      'The story of Diocletian, Salona and the Palace that became a city.' +
    '</div>' +
    '<div class="v2-whispers-ft">' +
      '<span class="v2-whispers-count">12 chapters</span>' +
      '<span class="v2-whispers-cta">Enter the Palace ' +
        '<svg class="v2-icon v2-icon--sm"><use href="#ico-arrow-right"/></svg>' +
      '</span>' +
    '</div>';
}

// ── Ask bubble tooltip init ────────────────────────────────────────────────────
function _v2InitAskBubble() {
  var tip = document.getElementById('v2-ask-tip');
  if (!tip) return;
  if (localStorage.getItem('olly_tooltip_seen')) {
    tip.classList.add('v2-ask-tip--out');
    return;
  }
  function dismissTip() {
    tip.classList.add('v2-ask-tip--out');
    localStorage.setItem('olly_tooltip_seen', 'true');
  }
  var autoDismiss = setTimeout(dismissTip, 6000);
  tip.addEventListener('click', function () {
    clearTimeout(autoDismiss);
    dismissTip();
  }, { once: true });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#v2-ask-wrap')) {
      clearTimeout(autoDismiss);
      dismissTip();
    }
  }, { once: true, capture: true });
}

// ── Populate events screen weather badge ──────────────────────────────────────
// wxCond: condition string e.g. "Clear"  |  wxTempC: number
function _v2UpdateEventsWeatherBadge(wxCond, wxTempC) {
  var badge = document.getElementById('st-weather-badge');
  if (!badge) return;
  var parts = [];
  if (wxCond && wxCond.trim()) parts.push(wxCond.trim());
  if (wxTempC !== undefined && !isNaN(wxTempC)) parts.push(wxTempC + '\xb0');

  // Friendly descriptor
  if (parts.length) {
    var c = (wxCond || '').toLowerCase();
    var isRainy = c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('storm');
    var isHot   = !isRainy && wxTempC !== undefined && wxTempC >= 32;
    var desc = isRainy ? 'Covered sights recommended'
             : isHot   ? 'Go early or after sunset'
             :            'Outdoor-friendly';
    parts.push(desc);
    badge.textContent = parts.join(' \xb7 ');
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ── Ask bubble tap handler ─────────────────────────────────────────────────────
function _v2AskTap() {
  var tip = document.getElementById('v2-ask-tip');
  if (tip && !tip.classList.contains('v2-ask-tip--out')) {
    tip.classList.add('v2-ask-tip--out');
    localStorage.setItem('olly_tooltip_seen', 'true');
  }
  gotoRoot('ask');
}

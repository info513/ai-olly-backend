// app.js — AI Olly PWA v2
// Full guest guide dashboard with navigation stack, maps, room guide,
// services, routes, near me, ask, requests and contact.

// ── URL params ────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const SLUG   = params.get('slug')  || '';
const ROOM   = params.get('room')  || '';
const TOKEN  = params.get('token') || '';

// ── Module state ──────────────────────────────────────────────────────────
let roomGuideData  = null;
let servicesData   = null;
let poisData       = null;   // loaded from /api/pwa-pois
let routesData     = null;   // loaded from /api/pwa-routes
let currentService = null;
let currentPoi     = null;
let currentRoute   = null;
let currentNmCat   = null;
let cityMapObj     = null;
let cityMapInited  = false;
let routeMapObj    = null;

// ── Navigation stack ──────────────────────────────────────────────────────
const ROOT_SCREENS = new Set(['home', 'city-map', 'ask', 'info']);
let currentScreen  = 'home';
let navStack       = [];

function _activateScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) {
    el.classList.add('active');
    currentScreen = name;
  }
  window.scrollTo(0, 0);
  updateBottomNav(name);

  // Leaflet invalidation — must happen after the element is visible
  if (name === 'city-map' && cityMapObj) {
    setTimeout(() => cityMapObj.invalidateSize(), 120);
  }
  if (name === 'route-map' && routeMapObj) {
    setTimeout(() => routeMapObj.invalidateSize(), 120);
  }

  // Screen-specific init / render
  if (name === 'city-map'   && !cityMapInited) initCityMap();
  if (name === 'room-guide') renderRoomGuideSections();
  if (name === 'services')   renderServicesList();
  if (name === 'routes')     renderRoutesList();
}

function pushScreen(name) {
  if (name === currentScreen) return;
  navStack.push(currentScreen);
  _activateScreen(name);
}

function popScreen() {
  const prev = navStack.pop();
  _activateScreen(prev || 'home');
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
  }
}

function openRoomGuideSection(section) {
  const sectionMap = {
    wifi:     'WiFi',
    ac:       'Air Conditioning',
    tv:       'TV',
    safe:     'Safe',
    features: 'Room Features',
    notes:    'Room Notes',
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

  html += `<div style="display:flex;gap:10px;">
    <button class="action-btn" style="flex:1;" onclick="gotoRoot('ask')">Ask Olly</button>
    <button class="action-btn action-btn--primary" style="flex:1;" onclick="pushScreen('contact')">Reception</button>
  </div>`;

  html += '</div>';
  body.innerHTML = html;
}

// ── Hotel Services ────────────────────────────────────────────────────────
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
  container.innerHTML = servicesData.map((s, i) => `
    <div class="service-card" onclick="openServiceDetail(${i})">
      <div class="service-card-title">${escHtml(s.naziv || '')}</div>
      ${s.radnoVrijeme ? `<div class="service-card-meta">${escHtml(s.radnoVrijeme)}</div>` : ''}
      ${s.opis ? `<div class="service-card-meta">${escHtml(s.opis.slice(0, 80))}${s.opis.length > 80 ? '\u2026' : ''}</div>` : ''}
    </div>
  `).join('');
}

function openServiceDetail(idx) {
  currentService = servicesData ? servicesData[idx] : null;
  if (!currentService) return;
  const cats = Array.isArray(currentService.kategorija) ? currentService.kategorija.join(', ') : '';
  setText('svc-category', cats);
  setText('svc-title', currentService.naziv || '');
  setText('svc-hours', currentService.radnoVrijeme || '');
  setText('svc-desc', currentService.opis || '');
  pushScreen('service-detail');
}

// ── City Map ──────────────────────────────────────────────────────────────
function initCityMap() {
  if (cityMapInited) return;
  const el = document.getElementById('city-map-leaflet');
  if (!el || typeof L === 'undefined') {
    // Leaflet not yet loaded — retry
    setTimeout(initCityMap, 300);
    return;
  }

  cityMapObj = L.map('city-map-leaflet', { zoomControl: true }).setView(
    [CONFIG.hotelCoords.lat, CONFIG.hotelCoords.lng], 15
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\u00a9 <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(cityMapObj);

  // Hotel marker
  const hotelIcon = L.divIcon({
    className: '',
    html: '<div style="width:14px;height:14px;background:#2c1f14;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #2c1f14;"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  L.marker([CONFIG.hotelCoords.lat, CONFIG.hotelCoords.lng], { icon: hotelIcon, zIndexOffset: 1000 })
    .addTo(cityMapObj)
    .bindTooltip('Hotel Antique Split', { permanent: false });

  // POI markers — added now if data is ready, otherwise added by loadPois() callback
  if (poisData) addPoiMarkersToMap();

  cityMapInited = true;
}

function addPoiMarkersToMap() {
  if (!cityMapObj || !poisData) return;
  const poiIcon = L.divIcon({
    className: '',
    html: '<div style="width:10px;height:10px;background:#8b6914;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  poisData.forEach((poi, idx) => {
    if (!poi.coords) return; // skip POIs without coordinates in Airtable
    L.marker([poi.coords.lat, poi.coords.lng], { icon: poiIcon })
      .addTo(cityMapObj)
      .on('click', () => showPoiMiniCard(idx));
  });
}

function showPoiMiniCard(idx) {
  const poi = poisData ? poisData[idx] : null;
  if (!poi) return;
  currentPoi = poi;
  setText('poi-mini-category', poi.category);
  setText('poi-mini-name', poi.name);
  setText('poi-mini-info', poi.dist + ' \u00b7 ' + poi.visit);
  show('poi-mini-card');
}

function closePoisMiniCard() {
  hide('poi-mini-card');
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
  setText('poi-meta', poi.dist + '  \u00b7  ' + poi.visit);
  setText('poi-short-desc', poi.shortDesc);
  setText('poi-long-desc', poi.longDesc);
  const navBtn = document.getElementById('poi-nav-btn');
  if (navBtn) navBtn.href = poi.nav;
}

function navigateToPoi() {
  if (currentPoi && currentPoi.nav) window.open(currentPoi.nav, '_blank');
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
  container.innerHTML = routesData.map((r, i) => `
    <div class="route-card" onclick="openRouteDetail(${i})">
      <div class="route-card-meta">
        ${r.type     ? `<span>${escHtml(r.type)}</span><span>\u00b7</span>` : ''}
        ${r.duration ? `<span>${escHtml(r.duration)}</span>` : ''}
      </div>
      <div class="route-card-title">${escHtml(r.name)}</div>
      ${r.shortDesc ? `<div class="route-card-desc">${escHtml(r.shortDesc)}</div>` : ''}
    </div>
  `).join('');
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

  // POI list — route.poiIds are Airtable record IDs; look up in poisData
  const poisContainer = document.getElementById('route-pois-list');
  if (poisContainer) {
    const localPois = poisData || [];
    const routePois = (currentRoute.poiIds || [])
      .map(id => localPois.find(p => p.id === id))
      .filter(Boolean);
    poisContainer.innerHTML = routePois.length
      ? routePois.map(p => `
          <div class="section-item" onclick="openPoiFromRoute('${escHtml(p.id)}')">
            <span>${escHtml(p.name)}</span>
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

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\u00a9 OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(routeMapObj);

  // Start marker
  const startIcon = L.divIcon({
    className: '',
    html: '<div style="width:14px;height:14px;background:#2c1f14;border:2px solid #fff;border-radius:50%;"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  L.marker([startCoords.lat, startCoords.lng], { icon: startIcon })
    .addTo(routeMapObj)
    .bindTooltip('Start: ' + (currentRoute.startPointName || ''), { permanent: false });

  // Route POI markers — look up from live poisData
  const routePois = (currentRoute.poiIds || [])
    .map(id => (poisData || []).find(p => p.id === id))
    .filter(Boolean);

  routePois.forEach((poi, i) => {
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
  if (!currentRoute?.startPoint?.coords) return;
  const { lat, lng } = currentRoute.startPoint.coords;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// ── Near Me ───────────────────────────────────────────────────────────────
const NM_CATEGORIES = [
  { id: 'landmarks',   label: 'Landmarks',          icon: '🏛', query: 'landmarks+historic+sites' },
  { id: 'beach',       label: 'Beach',               icon: '🏖', query: 'beach' },
  { id: 'pharmacy',    label: 'Pharmacy',             icon: '💊', query: 'pharmacy' },
  { id: 'atm',         label: 'ATM',                  icon: '🏧', query: 'ATM' },
  { id: 'supermarket', label: 'Supermarket',          icon: '🛒', query: 'supermarket' },
  { id: 'transport',   label: 'Ferry / Bus / Taxi',   icon: '🚌', query: 'ferry+bus+stop+taxi' },
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
    <div style="padding:8px 0;">
      <p style="font-size:15px;color:var(--text-muted);line-height:1.65;margin-bottom:16px;">
        View ${escHtml(cat.label.toLowerCase())} near Hotel Antique Split on the map.
      </p>
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="action-btn action-btn--primary" style="display:flex;text-align:center;justify-content:center;text-decoration:none;">
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
  if (input) {
    input.value = text;
    input.focus();
    onAskInput();
  }
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

// ── Ask Assistant ─────────────────────────────────────────────────────────
let askInFlight = false;

function resetAskScreen() {
  askInFlight = false;
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
  if (askInFlight) return;
  const input    = document.getElementById('ask-input');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  if (!TOKEN) {
    setText('ask-error', 'Your room link is incomplete. Please scan the QR code in your room again.');
    show('ask-error');
    return;
  }

  askInFlight = true;
  const btn   = document.getElementById('ask-btn');
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
    if (btn)   btn.disabled   = !(input && input.value.trim());

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
    if (input) input.disabled = false;
    if (btn)   btn.disabled   = !(input && input.value.trim());
    setText('ask-error', 'Unable to connect. Please check your connection and try again.');
    show('ask-error');
  } finally {
    askInFlight = false;
  }
}

function askErrorMessage(status) {
  if (status === 403) return ['Your room link has expired. Please scan the QR code in your room again.', false];
  if (status === 501) return ['Our assistant is temporarily unavailable. Please contact Reception for help.', true];
  if (status === 400) return ['Your question could not be processed. Please try rephrasing it.', false];
  return ['Something went wrong. Please try again or contact Reception directly.', true];
}

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
    if (data.hotelName) setText('hotel-name', data.hotelName);
    if (data.aiWelcome) {
      setText('welcome-text', data.aiWelcome);
      show('welcome-text');
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
    if (data.ok) servicesData = data.services || [];
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

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ── Boot ──────────────────────────────────────────────────────────────────
function boot() {
  // Room display
  const roomEl  = document.getElementById('room-number');
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

  // Info screen
  setText('info-hotel-name', CONFIG.hotelName);
  setText('info-address',    CONFIG.address    || '');
  setText('info-phone',      CONFIG.phone);
  setText('info-checkin',    CONFIG.checkIn    || '');
  setText('info-checkout',   CONFIG.checkOut   || '');

  if (!ROOM || !TOKEN) show('param-warning');

  gotoRoot('home');

  // Load per-room data in background
  if (ROOM && TOKEN) {
    fetchWelcomeData();
    loadRoomGuide();
    loadServices();
    loadPois();
    loadRoutes();
  }
}

document.addEventListener('DOMContentLoaded', boot);

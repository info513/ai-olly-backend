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
let poiMarkers          = [];   // { marker, poi, idx } — for category filtering
let selectedPoiEntry   = null; // currently highlighted marker entry

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

  html += `<div class="detail-actions detail-actions--row">
    <button class="action-btn" onclick="gotoRoot('ask')">Ask Olly</button>
    <button class="action-btn action-btn--primary" onclick="pushScreen('contact')">Reception</button>
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

// Map each POI category string to an emoji for the marker
function categoryToEmoji(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('plaža') || c.includes('beach') || c.includes('kupanje')) return '🏖';
  if (c.includes('restoran') || c.includes('restaurant'))                   return '🍽';
  if (c.includes('kafić') || c.includes('kava') || c.includes('cafe') ||
      c.includes('bar') || c.includes('lounge'))                            return '☕';
  if (c.includes('crkva') || c.includes('palača') || c.includes('muzej') ||
      c.includes('kulturno') || c.includes('landmark') ||
      c.includes('history') || c.includes('museum'))                        return '🏛';
  if (c.includes('park') || c.includes('priroda') || c.includes('garden')) return '🌿';
  if (c.includes('kupovina') || c.includes('shop') ||
      c.includes('market') || c.includes('tržnica'))                        return '🛍';
  if (c.includes('trajekt') || c.includes('ferry') ||
      c.includes('prijevoz') || c.includes('transport'))                    return '⛴';
  if (c.includes('noćni') || c.includes('night') || c.includes('club'))    return '🎵';
  if (c.includes('atm') || c.includes('bankomat'))                         return '🏧';
  if (c.includes('ljekarna') || c.includes('pharmacy'))                    return '💊';
  return '📍';
}

function createPoiIcon(category) {
  const emoji = categoryToEmoji(category);
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;background:#fff;border:2.5px solid #c9a227;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 10px rgba(0,0,0,0.22);cursor:pointer;">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Selected state — larger, dark background, gold ring, pulse animation via CSS class
function createPoiIconSelected(category) {
  const emoji = categoryToEmoji(category);
  return L.divIcon({
    className: 'poi-marker-selected',
    html: `<div style="width:42px;height:42px;background:#2c1f14;border:3px solid #c9a227;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 0 0 6px rgba(201,162,39,0.25),0 4px 16px rgba(0,0,0,0.4);cursor:pointer;">${emoji}</div>`,
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
    html: '<div style="width:38px;height:38px;background:#2c1f14;border:3px solid #f5edd8;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 3px 12px rgba(0,0,0,0.45);">⭐</div>',
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
    chip.textContent = categoryToEmoji(cat) + '\u2009' + cat;
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

  const emoji = categoryToEmoji(category);
  titleEl.textContent = emoji + '\u2009' + category;

  const items = poiMarkers.filter(({ poi }) => poi.category === category);

  listEl.innerHTML = items.length
    ? items.map(({ poi, idx }) => `
        <div class="map-cat-panel-item" onclick="panToPoiAndShowCard(${idx})">
          <div class="map-cat-panel-icon">${categoryToEmoji(poi.category)}</div>
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
  const meta = [poi.dist, poi.visit].filter(Boolean).join('  \u00b7  ');
  setText('poi-meta', meta);
  setText('poi-short-desc', poi.shortDesc);
  setText('poi-long-desc', poi.longDesc);
  const navBtn = document.getElementById('poi-nav-btn');
  if (navBtn) navBtn.href = poi.nav || '#';
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

  // CartoDB Voyager — consistent with city map
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(routeMapObj);

  // Start marker — hotel star
  const startIcon = L.divIcon({
    className: '',
    html: '<div style="width:32px;height:32px;background:#2c1f14;border:2.5px solid #f5edd8;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.35);">⭐</div>',
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

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

async function fetchSplitTemperature() {
  try {
    const res  = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=43.5081&longitude=16.4402&current=temperature_2m'
    );
    const data = await res.json();
    const temp = Math.round(data?.current?.temperature_2m);
    if (!isNaN(temp)) {
      setText('wh-temp', temp + '°C');
      show('wh-weather');
    }
  } catch (_) { /* silent */ }
}

function enterApp() {
  gotoRoot('home');
}

function boot() {
  // Splash room display
  setText('splash-room-number', ROOM || '—');
  setText('room-number',        ROOM || '—');

  // Home greeting
  setText('wh-greeting', getGreeting());

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

  // Info screen
  setText('info-hotel-name', CONFIG.hotelName);
  setText('info-address',    CONFIG.address    || '');
  setText('info-phone',      CONFIG.phone);
  setText('info-checkin',    CONFIG.checkIn    || '');
  setText('info-checkout',   CONFIG.checkOut   || '');

  if (!ROOM || !TOKEN) show('param-warning');

  // Show splash screen first; guest taps "Enter" to proceed to home
  _activateScreen('app-splash');

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

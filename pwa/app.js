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
let eventsData       = null; // loaded from /api/pwa-events
let currentEvent     = null; // currently open event
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
    // Reset to Today tab on each open
    activeEventsTab = 'today';
    document.querySelectorAll('.st-tab').forEach((b, i) => b.classList.toggle('st-tab--active', i === 0));
    if (!eventsData) loadEvents();
    else renderEventsList();
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

function _routeIcon(type) {
  const t = (type || '').toLowerCase();
  if (/cycl|bike/.test(t))       return '🚴';
  if (/driv|car/.test(t))        return '🚗';
  if (/boat|sea|kayak/.test(t))  return '⛵';
  return '🚶';
}

const SERVICE_GROUPS = [
  { id: 'arrival', icon: '🛎', label: 'Arrival & Reception',
    keywords: ['reception', 'check-in', 'check in', 'check out', 'check-out',
               'late arrival', 'luggage', 'contact', 'direct booking',
               'booking & offers', 'booking and offers', 'r1', 'tourist tax',
               'invoice', 'payment', 'front desk', 'concierge'] },
  { id: 'room', icon: '🛏', label: 'Room Comfort',
    keywords: ['room feature', 'room/communication', 'air condition', 'television', ' tv',
               'safe', 'smart glass', 'minibar', 'pillow', 'blanket',
               'room service', 'room layout', 'room view', 'twin bed',
               'extra bed', 'family room', 'rooms & booking', 'rooms and booking',
               'family & booking', 'family and booking', 'family & comfort',
               'family and comfort', 'family comfort'] },
  { id: 'housekeeping', icon: '✨', label: 'Housekeeping & Laundry',
    keywords: ['housekeep', 'laundry', 'towel', 'linen', 'clean',
               'do not disturb', 'fabric softener', 'washing not', 'drying not'] },
  { id: 'food', icon: '☕', label: 'Breakfast & Food',
    keywords: ['food and beverage', 'food & beverage', 'beverage', 'breakfast',
               'dietary', 'kids breakfast', 'room breakfast', 'local food',
               'drink', 'meal', 'dining', 'where locals eat'] },
  { id: 'transport', icon: '🚗', label: 'Transport & Parking',
    keywords: ['parking', 'airport', 'taxi', 'ferry', 'bus station',
               'boat tour', 'island trip', 'private transport', 'transfer', 'shuttle'] },
  { id: 'policies', icon: '📋', label: 'Policies & Safety',
    keywords: ['house rule', 'safety', 'security', 'emergency', 'fire',
               'smoking', 'pet policy', 'quiet hour', 'cooking not',
               'key policy', 'cctv', 'rule', 'policy', 'payment method'] },
  { id: 'experiences', icon: '🌟', label: 'Local Experiences',
    keywords: ['fun and relax', 'fun & relax', 'one day in split', 'sunset',
               'beach', 'private tour', 'rainy day', 'souvenir',
               'authentic', 'local experience', 'split guide', 'restaurant',
               'where to eat', 'event'] },
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
        <span>${entry.icon}</span>
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
          <span>${entry.icon}</span>
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

  // Meta line: 📍 distance  ·  🕐 visit duration
  const parts = [];
  if (poi.dist)  parts.push('📍 ' + poi.dist);
  if (poi.visit) parts.push('🕐 ' + poi.visit);
  setText('poi-meta', parts.join('   ·   '));

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
  container.innerHTML = `<div class="section-list">${
    routesData.map((r, i) => {
      const icon = _routeIcon(r.type);
      const subParts = [];
      if (r.type)     subParts.push(escHtml(r.type));
      if (r.duration) subParts.push('\u23f1 ' + escHtml(r.duration));
      const sub = subParts.join(' \u00b7 ');
      return `
        <div class="section-item" onclick="openRouteDetail(${i})">
          <span>${icon}</span>
          <span class="section-item-body">
            <span>${escHtml(r.name)}</span>
            ${sub ? `<span class="section-item-sub">${sub}</span>` : ''}
          </span>
          <span class="section-arrow">\u203a</span>
        </div>`;
    }).join('')
  }</div>`;
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
  if (code === 0)               return '☀️';
  if (code <= 2)                return '🌤️';
  if (code <= 3)                return '☁️';
  if (code <= 48)               return '🌫️';
  if (code <= 57)               return '🌦️';
  if (code <= 67)               return '🌧️';
  if (code <= 77)               return '❄️';
  if (code <= 82)               return '🌦️';
  if (code <= 86)               return '🌨️';
  return '⛈️';
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

    // Current temperature (top-right corner)
    const temp = Math.round(data?.current?.temperature_2m);
    if (!isNaN(temp)) {
      setText('wh-temp', temp + '°C');
      show('wh-weather');
    }

    // 5-day forecast strip
    if (data?.daily) renderWeatherForecast(data.daily);

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
    loadPartners();
    loadEvents();
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

function renderEventsList() {
  const list    = document.getElementById('events-list');
  const loading = document.getElementById('events-loading');
  if (!list) return;

  hide('events-loading');

  if (!eventsData) {
    list.innerHTML = '';
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  let filtered;
  if (activeEventsTab === 'today') {
    filtered = eventsData.filter(ev => ev.tip === 'Event' && ev.date === todayStr);
  } else if (activeEventsTab === 'upcoming') {
    filtered = eventsData.filter(ev => ev.tip === 'Event' && ev.date > todayStr);
  } else {
    filtered = eventsData.filter(ev => ev.tip === 'Always on');
  }

  if (filtered.length === 0) {
    const msgs = {
      today:    'No events scheduled for today.',
      upcoming: 'No upcoming events at the moment.',
      alwayson: 'No permanent attractions listed yet.',
    };
    list.innerHTML = `<p style="color:var(--text-secondary);font-size:14px;padding:8px 0">${msgs[activeEventsTab]}</p>`;
    return;
  }

  // Map filtered items back to global eventsData indices for detail navigation
  list.innerHTML = filtered.map(ev => {
    const globalIdx = eventsData.indexOf(ev);
    const showDate  = ev.tip === 'Event' && ev.date;
    return `
      <div class="ev-card" onclick="openEventDetail(${globalIdx})">
        <div class="ev-card-header">
          ${showDate ? `<div class="ev-card-date">${_formatEventDate(ev.date)}</div>` : ''}
          <div class="ev-card-name">${escHtml(ev.name)}</div>
        </div>
        <div class="ev-card-body">
          <div class="ev-card-desc">${escHtml(ev.description)}</div>
          <div class="ev-card-arrow">Read more →</div>
        </div>
      </div>
    `;
  }).join('');
}

function openEventDetail(idx) {
  currentEvent = eventsData[idx];
  if (!currentEvent) return;

  // Hero emoji based on keywords
  const name = currentEvent.name.toLowerCase();
  let emoji = '🎭';
  if (name.includes('wine') || name.includes('tasting'))                              emoji = '🍷';
  else if (name.includes('kayak') || name.includes('swim') || name.includes('sea'))   emoji = '🚣';
  else if (name.includes('music') || name.includes('concert') || name.includes('festival') || name.includes('singing')) emoji = '🎶';
  else if (name.includes('food') || name.includes('market') || name.includes('beer')) emoji = '🍻';
  else if (name.includes('palace') || name.includes('diocletian') || name.includes('history')) emoji = '🏛️';
  else if (name.includes('tour'))                                                      emoji = '🗺️';
  else if (name.includes('beach') || name.includes('bačvice'))                        emoji = '🏖️';
  else if (name.includes('marjan') || name.includes('hill') || name.includes('park')) emoji = '🌿';
  else if (name.includes('market') || name.includes('pazar'))                         emoji = '🛒';
  else if (name.includes('riva') || name.includes('promenade'))                       emoji = '🌊';
  else if (name.includes('night'))                                                     emoji = '🌙';

  document.getElementById('ev-detail-hero').textContent = emoji;
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
      <span class="conc-item-icon">🍽</span>
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
  if (p.price)      badges.push(`<span class="rest-badge">💰 ${escHtml(p.price)}</span>`);
  if (p.atmosphere) badges.push(`<span class="rest-badge">✨ ${escHtml(p.atmosphere)}</span>`);
  const metaEl = document.getElementById('rest-detail-meta');
  if (metaEl) metaEl.innerHTML = badges.join('');

  setText('rest-detail-desc', p.description);

  // Detail info list
  const infoEl = document.getElementById('rest-detail-info');
  if (infoEl) {
    const rows = [];
    if (p.hours)   rows.push(`<div class="section-item" style="cursor:default;"><span>🕐 Hours</span><span style="color:var(--text-muted);font-size:14px;">${escHtml(p.hours)}</span></div>`);
    if (p.address) rows.push(`<div class="section-item" style="cursor:default;"><span>📍 Address</span><span style="color:var(--text-muted);font-size:14px;">${escHtml(p.address)}</span></div>`);
    if (p.mapsUrl) rows.push(`<div class="section-item" onclick="_openExternal('${escHtml(p.mapsUrl)}')"><span>🗺 Open in Maps</span><span class="section-arrow">›</span></div>`);
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
  const titles = { taxi: 'Taxi Request', boat: 'Boat Transfer', shuttle: 'Airport Shuttle', restaurant: 'Reserve a Table', wakeup: 'Wake-up Call' };
  const icons  = { taxi: '🚕', boat: '⛵', shuttle: '🚐', restaurant: '🍽', wakeup: '⏰' };
  const emojis = { taxi: '🚕', boat: '⛵', shuttle: '🚐', restaurant: '🍽', wakeup: '⏰' };

  setText('conc-form-title', titles[type] || 'Request');

  // Hero emoji
  const hero = document.getElementById('conc-form-hero');
  if (hero) hero.textContent = emojis[type] || '🛎';

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

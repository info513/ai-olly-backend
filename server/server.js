// server.js — AI OLLY HUB
// Endpoints: /api/health, /api/debug, /api/web-ask,
//            /api/pwa-ask, /api/pwa-request, /api/pwa-welcome,
//            /api/pwa-room-guide, /api/pwa-services, /api/pwa-pois, /api/pwa-routes,
//            /api/pwa-partners, /api/pwa-push-subscribe, /api/webhook/request-status,
//            /api/reception/create-consent-session, /api/reception/consent-context,
//            /api/reception/save-guest, /api/reception/save-consent
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Airtable from 'airtable';
import OpenAI from 'openai';
import webpush from 'web-push';
import { normalizeText, detectLang, isContactCoreQuestion, isBreakfastHoursQuestion, isHousekeepingHoursQuestion, isWifiQuestion, isPetPolicyQuestion, isHotelSpecificQuestion, isCityQuestion, isAcQuestion, isTvQuestion, isSafeQuestion, isCityActivityQuestion, isCheckinTimeOnlyQuestion, isEmergencyQuestion, isParkingAvailabilityQuery, isWhatsAppQuestion, isMaintenanceReportQuestion, isRoomNumberQuestion, isExtraTowelsQuestion } from './classify.js';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { asArray, isEmptyArray, fieldHasAny, valuesToStrings, matchesHotelSlug, allowForWeb, allowForPWA } from './filters.js';

const {
  PORT = 8080,
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o',

  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,

  HOTEL_SLUG_DEFAULT = 'antique-split',

  // Airtable table names
  TABLE_SERVICES = 'SERVICES',
  TABLE_ROOMS = 'SOBE',
  TABLE_HOTELS = 'HOTELI',
  TABLE_INTENTS = 'AI_INTENT_PATTERNS',
  TABLE_OUTPUT_RULES = 'AI_OUTPUT_RULES',
  TABLE_ROOM_GUIDE = 'ROOM GUIDE',
  TABLE_REQUESTS   = 'REQUESTS',
  TABLE_POI        = 'POI',
  TABLE_ROUTES     = 'ROUTES',
  TABLE_PARTNERS        = 'PARTNERS',
  TABLE_EVENTS          = 'EVENTS',
  TABLE_FEEDBACK        = 'FEEDBACK',
  TABLE_PUSH_SUBS       = 'PUSH_SUBSCRIPTIONS',
  TABLE_NOVOSTI         = 'NOVOSTI',
  TABLE_PRIVOLE         = 'PRIVOLE',
  TABLE_GUESTS          = 'GUESTS',
  TABLE_STAYS           = 'STAYS',
  TABLE_RESPONSE_LOGS   = 'AI_RESPONSE_LOGS',
  TABLE_UNANSWERED      = 'UNANSWERED_QUESTIONS',

  // Push notifications (VAPID)
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  WEBHOOK_SECRET = 'antique-split-webhook-2026',
  RECEPTION_PIN  = 'recepcija2026',

  // CORS
  CORS_ORIGINS = '',
} = process.env;

// ── Web Push setup ───────────────────────────────────────────────────────────
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:info@pressmax.net', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('✅ Web Push (VAPID) configured');
} else {
  console.warn('⚠️  VAPID keys missing — push notifications disabled');
}

// In-memory push subscriptions: key = `${slug}:${room}`
// Backed by Airtable PUSH_SUBSCRIPTIONS — survives server restarts
const pushSubscriptions = new Map();

// ── Consent sessions ──────────────────────────────────────────────────────────
// Short-lived tokens so WEBHOOK_SECRET never appears in a browser URL.
// key = token (64-char hex), value = { slug, room, name, email, guestId, stayId, expires, used }
const consentSessions = new Map();

const CONSENT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateConsentToken() {
  return randomBytes(32).toString('hex'); // 64-char hex string
}

// Purge expired sessions (called on each create-consent-session request)
function purgeExpiredConsentSessions() {
  const now = Date.now();
  for (const [token, session] of consentSessions) {
    if (session.expires < now) consentSessions.delete(token);
  }
}

async function loadPushSubscriptionsFromAirtable() {
  try {
    const recs = await airtableSelectAll(TABLE_PUSH_SUBS, {
      filterByFormula: `{Active}=TRUE()`,
      pageSize: 100,
    });
    let loaded = 0;
    for (const r of recs) {
      const slug = r.fields['HotelSlug'] || '';
      const room = r.fields['Room']      || '';
      const raw  = r.fields['Subscription'] || '';
      if (!slug || !room || !raw) continue;
      try {
        const sub = JSON.parse(raw);
        pushSubscriptions.set(`${slug}:${room}`, { sub, airtableId: r.id });
        loaded++;
      } catch (_) { /* bad JSON, skip */ }
    }
    console.log(`[push] Loaded ${loaded} subscriptions from Airtable`);
  } catch (e) {
    console.warn('[push] Could not load subscriptions from Airtable:', e.message);
  }
}

async function savePushSubscriptionToAirtable(hotelSlug, room, subscription) {
  try {
    // Check if record already exists (upsert)
    const existing = pushSubscriptions.get(`${hotelSlug}:${room}`);
    if (existing?.airtableId) {
      await base(TABLE_PUSH_SUBS).update(existing.airtableId, {
        'Subscription': JSON.stringify(subscription),
        'Active': true,
        'CreatedAt': new Date().toISOString(),
      });
      return existing.airtableId;
    }
    const created = await base(TABLE_PUSH_SUBS).create({
      'HotelSlug':    hotelSlug,
      'Room':         room,
      'Subscription': JSON.stringify(subscription),
      'Active':       true,
      'CreatedAt':    new Date().toISOString(),
    });
    return created.id;
  } catch (e) {
    console.warn('[push] Could not save subscription to Airtable:', e.message);
    return null;
  }
}

if (!OPENAI_API_KEY || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('❗ Missing env vars: OPENAI_API_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID');
  process.exit(1);
}

// Render build marker
const BUILD =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  'local';

const app = express();

// -------------------------
// CORS
// -------------------------
const allowedOrigins = [
  ...String(CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  // Render automatically sets RENDER_EXTERNAL_URL — always allow same-origin POSTs
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS_BLOCKED:${origin}`));
  },
  credentials: false,
}));

app.use((err, req, res, next) => {
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS_BLOCKED:')) {
    return res.status(403).json({ ok: false, error: 'CORS blocked', origin: err.message.replace('CORS_BLOCKED:', '') });
  }
  return next(err);
});

app.use(express.json({ limit: '4mb' }));  // 4mb for signature PNG base64
app.use('/pwa',       express.static('pwa'));
app.use('/reception', express.static('reception'));
app.use('/cathedra',  express.static('cathedra'));

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

Airtable.configure({ apiKey: AIRTABLE_API_KEY });
const base = Airtable.base(AIRTABLE_BASE_ID);

// -------------------------
// Helpers
// -------------------------
const nowIso = () => new Date().toISOString();

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function clampPageSize(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 50;
  if (x < 1) return 1;
  if (x > 100) return 100;
  return Math.floor(x);
}

function escapeAirtableFormulaString(s) {
  return String(s ?? '').replace(/'/g, "''");
}

async function airtableSelectAll(tableName, options = {}) {
  const records = [];
  const safe = { ...options };
  safe.pageSize = clampPageSize(safe.pageSize ?? 50);

  await base(tableName).select(safe).eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });

  return records;
}

async function airtableSelectFirst(tableName, options = {}) {
  const safe = { ...options };
  safe.pageSize = clampPageSize(safe.pageSize ?? 1);
  safe.maxRecords = 1;

  const recs = await airtableSelectAll(tableName, safe);
  return recs[0] || null;
}

// ✅ čitanje linked recorda po ID (ne ovisi o filterima i slugovima)
async function airtableFindByIds(tableName, ids = [], limit = 30) {
  const uniq = Array.from(new Set(asArray(ids).map(String).filter(Boolean))).slice(0, limit);
  if (!uniq.length) return [];

  const out = await Promise.allSettled(
    uniq.map(id => base(tableName).find(id))
  );

  return out
    .filter(x => x.status === 'fulfilled' && x.value)
    .map(x => x.value);
}

// “siguran select”: pokušaj svaki filter redom; ako svi failaju, vrati [] (fail-closed).
// Ako je fallbackOptions eksplicitno proslijeđen (ne null), koristi ga kao zadnji resort.
async function airtableSelectAllSafe(tableName, tryOptions = [], fallbackOptions = null) {
  for (const opt of tryOptions) {
    try {
      const recs = await airtableSelectAll(tableName, opt);
      if (Array.isArray(recs) && recs.length) return recs;
    } catch (e) {
      // ignore and try next
    }
  }
  if (fallbackOptions === null) return []; // fail-closed: ne vraćaj sve zapise
  return airtableSelectAll(tableName, fallbackOptions);
}

function tokenize(s) {
  const t = normalizeText(s);
  if (!t) return [];
  return t.split(/\s+/).filter(Boolean);
}

function isRoomTypesQuestion(question) {
  const q = normalizeText(question);
  if (q.includes('vrste soba')) return true;
  if (q.includes('tipovi soba')) return true;
  if (q.includes('room types')) return true;
  if (q.includes('types of rooms')) return true;

  const hasRooms = q.includes('soba') || q.includes('rooms') || q.includes('room');
  const hasTypes = q.includes('vrste') || q.includes('tip') || q.includes('types') || q.includes('type');
  return hasRooms && hasTypes;
}

function isRoomAmenitiesQuestion(question) {
  const q = normalizeText(question);
  const hasAmen = q.includes('amenities') || q.includes('amenity') || q.includes('sadržaj') || q.includes('oprema') || q.includes('what is in the room');
  const hasRoom = q.includes('room') || q.includes('rooms') || q.includes('soba') || q.includes('sobe');
  return hasAmen && (hasRoom || q.includes('deluxe') || q.includes('superior') || q.includes('standard') || q.includes('comfort'));
}

/**
 * ✅ FIX: "parking" sadrži substring "king" -> više ne smije okidati bed_types.
 * Logika: "king/twin/bed/krevet" moraju biti tokeni (riječi) ili jasna fraza "king size".
 */
function isBedTypeQuestion(question) {
  const qNorm = normalizeText(question);
  const toks = tokenize(question);

  const hasKingWord = toks.includes('king');
  const hasTwinWord = toks.includes('twin');
  const hasKingSize = qNorm.includes('king size');

  const hasBedWord = toks.includes('bed') || toks.includes('beds');
  const hasHrBedWord = toks.includes('krevet') || toks.includes('kreveti');

  return hasKingWord || hasTwinWord || hasKingSize || hasBedWord || hasHrBedWord;
}

function isRoomDifferenceQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('razlika') ||
    q.includes('difference') ||
    q.includes('compare') ||
    q.includes('usporedi') ||
    q.includes('vs') ||
    q.includes('versus')
  );
}

// ✅ pitanja o pogledu / UNESCO / Palace view (deterministički popis)
function isRoomViewListQuestion(question) {
  const q = normalizeText(question);
  const hasView = q.includes('view') || q.includes('pogled');
  const hasWhichRooms = q.includes('which rooms') || q.includes('koje sobe') || q.includes('which room') || q.includes('koja soba');
  const hasUnesco = q.includes('unesco') || q.includes('palace') || q.includes('palač') || q.includes('peristil') || q.includes('cathedral') || q.includes('katedr');
  return (hasView && (hasWhichRooms || hasUnesco)) || (hasWhichRooms && hasUnesco);
}

// -------------------------
// Stability: local rate limit (returns "wait 20 seconds")
// -------------------------
const RL_WINDOW_MS = 20_000;
const RL_MAX = 12;
const RL = new Map(); // ip -> { tsStart, count }

function shouldRateLimit(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const cur = RL.get(key);
  if (!cur) {
    RL.set(key, { tsStart: now, count: 1 });
    return false;
  }
  if (now - cur.tsStart > RL_WINDOW_MS) {
    RL.set(key, { tsStart: now, count: 1 });
    return false;
  }
  cur.count += 1;
  RL.set(key, cur);
  return cur.count > RL_MAX;
}

function renderWait20s(lang = 'HR') {
  return lang === 'EN'
    ? 'Too many requests in a short time. Please wait 20 seconds and try again.'
    : 'Previše upita u kratkom vremenu. Pričekajte 20 sekundi i pokušajte ponovno.';
}

function isOpenAIRateLimitError(e) {
  const status = e?.status || e?.response?.status;
  const code = e?.code;
  const msg = String(e?.message || '');
  return status === 429 || code === 'rate_limit_exceeded' || msg.toLowerCase().includes('rate limit') || msg.includes('429');
}

// -------------------------
// Cache
// -------------------------
const CACHE_TTL_MS = 60 * 1000;
let CACHE = {
  intents: { ts: 0, data: [] },
  outputRules: { ts: 0, data: [] },
  servicesByHotel: new Map(),
  roomsByHotel: new Map(),
  hotelBySlug: new Map(),
  pwaServicesByHotel: new Map(), // PWA: AI_SOURCE=PWA|BOTH, keyed by hotelSlug
  roomGuideByHotel: new Map(),   // PWA: ROOM GUIDE records, keyed by hotelSlug
  intentsPwa: { ts: 0, data: [] }, // PWA intent patterns — separate bucket from intents (WEB)
};

function cacheFresh(ts) {
  return (Date.now() - ts) < CACHE_TTL_MS;
}

// -------------------------
// AI_INTENT_PATTERNS (WEB only)
// -------------------------
async function getIntentPatternsForWeb() {
  if (cacheFresh(CACHE.intents.ts) && CACHE.intents.data.length) return CACHE.intents.data;

  const recs = await airtableSelectAll(TABLE_INTENTS, { pageSize: 100 });

  const patterns = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      intent: pickFirstNonEmpty(f.Intent, f.intent),
      phrases: pickFirstNonEmpty(f.Phrases, f.phrases),
      appliesTo: asArray(f['Applies to'] ?? f.AppliesTo ?? f.applies_to),
      outputScope: pickFirstNonEmpty(f['Output Scope'], f.OutputScope, f.output_scope),

      // linked record IDs
      servicesLink: asArray(f['Services link'] ?? f.ServicesLink ?? f.services_link),
      roomsLink: asArray(f['Rooms link'] ?? f.RoomsLink ?? f.rooms_link),

      active: (f.Active ?? true) === true,
    };
  }).filter(p => p.intent && p.active);

  const filtered = patterns.filter(p => fieldHasAny(p.appliesTo, ['WEB']));

  CACHE.intents = { ts: Date.now(), data: filtered };
  return filtered;
}

// -------------------------
// AI_INTENT_PATTERNS (PWA only)
// Separate cache bucket from WEB — never share; filter differs.
// Patterns tagged Applies to=PWA (may overlap with WEB where both values present).
// -------------------------
async function getIntentPatternsForPwa() {
  if (cacheFresh(CACHE.intentsPwa.ts) && CACHE.intentsPwa.data.length) return CACHE.intentsPwa.data;

  const recs = await airtableSelectAll(TABLE_INTENTS, { pageSize: 100 });

  const patterns = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      intent: pickFirstNonEmpty(f.Intent, f.intent),
      phrases: pickFirstNonEmpty(f.Phrases, f.phrases),
      appliesTo: asArray(f['Applies to'] ?? f.AppliesTo ?? f.applies_to),
      outputScope: pickFirstNonEmpty(f['Output Scope'], f.OutputScope, f.output_scope),
      servicesLink: asArray(f['Services link'] ?? f.ServicesLink ?? f.services_link),
      roomsLink: asArray(f['Rooms link'] ?? f.RoomsLink ?? f.rooms_link),
      active: (f.Active ?? true) === true,
    };
  }).filter(p => p.intent && p.active);

  const filtered = patterns.filter(p => fieldHasAny(p.appliesTo, ['PWA']));

  CACHE.intentsPwa = { ts: Date.now(), data: filtered };
  return filtered;
}

// -------------------------
// AI_OUTPUT_RULES
// -------------------------
async function loadOutputRules() {
  if (!cacheFresh(CACHE.outputRules.ts) || !CACHE.outputRules.data.length) {
    const recs = await airtableSelectAll(TABLE_OUTPUT_RULES, { pageSize: 100 });

    const rules = recs.map(r => {
      const f = r.fields || {};
      return {
        id: r.id,
        refId: pickFirstNonEmpty(f['Ref ID'], f.RefID, f.ref_id),
        scope: pickFirstNonEmpty(f.Scope, f.scope),
        format: pickFirstNonEmpty(f.Format, f.format),
        style: pickFirstNonEmpty(f.Style, f.style),
        example: pickFirstNonEmpty(f['Example Output'], f.ExampleOutput, f.example_output),
        priority: Number(f.Priority ?? f.priority ?? 0),
        isActive: (f.Active ?? f['Is Active'] ?? true) === true,
        aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
      };
    });

    CACHE.outputRules = { ts: Date.now(), data: rules };
  }
  return CACHE.outputRules.data;
}

async function getOutputRule({ scopeWanted = 'General', aiSourceWanted = 'WEB' }) {
  const rulesAll = await loadOutputRules();

  const scopeNorm = String(scopeWanted || 'General').toLowerCase();
  const filtered = rulesAll
    .filter(r => r.isActive)
    .filter(r => String(r.scope || '').toLowerCase() === scopeNorm)
    .filter(r => isEmptyArray(r.aiSource) || fieldHasAny(r.aiSource, [aiSourceWanted]));

  filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return filtered[0] || null;
}

// -------------------------
// Intent router (samo routing)
// + heuristic fallback ako je confidence nizak ili null intent
// + pre-router (deterministički) za “kritične” keyworde da ne ode u krive recorde
// -------------------------
function tokensWithSynonyms(question) {
  const t = tokenize(question);
  const extra = [];
  const q = normalizeText(question);

  const add = (...arr) => extra.push(...arr);

  if (q.includes('check in') || q.includes('checkin') || q.includes('prijava')) add('checkin', 'arrival', 'prijava');
  if (q.includes('check out') || q.includes('checkout') || q.includes('odjava')) add('checkout', 'departure', 'odjava');
  if (q.includes('wifi') || q.includes('wi fi') || q.includes('internet')) add('wifi', 'internet', 'password', 'lozinka');
  if (q.includes('parking') || q.includes('parkiranje') || q.includes('rampa') || q.includes('gate')) add('parking', 'rampa', 'gate', 'ramp');
  if (q.includes('breakfast') || q.includes('doručak') || q.includes('dorucak')) add('breakfast', 'doručak', 'menu', 'vrijeme');
  if (q.includes('amenities') || q.includes('oprema') || q.includes('sadržaj') || q.includes('sadrzaj')) add('amenities', 'oprema', 'sadržaj');
  // ✅ FIX: ovdje je ok da dodamo "king" kao token, ali samo ako user stvarno ima riječ "king" u pitanju.
  // q.includes('king') je substring; koristimo tokene.
  const toks = tokenize(question);
  if (toks.includes('twin') || toks.includes('king') || toks.includes('bed') || toks.includes('krevet') || toks.includes('kreveti') || normalizeText(question).includes('king size')) {
    add('bed', 'krevet', 'twin', 'king');
  }
  if (q.includes('minibar') || q.includes('mini bar')) add('minibar', 'mini bar', 'price list');
  if (q.includes('transfer') || q.includes('airport') || q.includes('zračna') || q.includes('zracna')) add('transfer', 'airport', 'pickup', 'shuttle');
  if (q.includes('laundry') || q.includes('washing') || q.includes('dry cleaning') || q.includes('pras')) add('laundry', 'washing', 'dry cleaning');
  if (q.includes('smoking') || q.includes('smoke') || q.includes('pušen')) add('smoking', 'non smoking', 'smoke');
  if (q.includes('taxi') || q.includes('uber')) add('taxi', 'uber', 'drop off');
  if (q.includes('directions') || q.includes('how to get') || q.includes('upute') || q.includes('dolazak')) add('directions', 'arrival', 'how to get');

  return Array.from(new Set([...t, ...extra].map(String).filter(Boolean)));
}

function findPatternByKeyword(patterns, keywords = []) {
  const keys = keywords.map(k => normalizeText(k)).filter(Boolean);
  if (!keys.length) return null;

  let best = null;
  let bestScore = 0;

  for (const p of patterns || []) {
    const hay = normalizeText(`${p.intent || ''} ${p.phrases || ''}`);
    let s = 0;
    for (const k of keys) {
      if (k.length < 3) continue;
      if (hay.includes(k)) s += 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 1 ? best : null;
}

// ✅ pre-router: ako je pitanje “parking / smoking / minibar / breakfast / transfer / taxi / directions / tax / R1”
// prvo pokušaj pogoditi intent bez GPT-a (da ne ode u SOBE)
function preRouteIntent(question, patterns) {
  const q = normalizeText(question);

  const buckets = [
    { keys: ['parking', 'parkiranje', 'rampa', 'gate', 'drop off', 'drop-off'], note: 'pre_router_parking' },
    { keys: ['smoking', 'non smoking', 'smoke', 'pušenje', 'pusenje'], note: 'pre_router_smoking' },
    { keys: ['minibar', 'mini bar', 'price list', 'cjenik'], note: 'pre_router_minibar' },
    // Fix #9: breakfast_included must fire BEFORE generic breakfast bucket —
    // "is breakfast included in the rate?" contains 'breakfast' so the generic
    // bucket would capture it first and route to breakfast_menu_main.
    { keys: ['breakfast included', 'included in the rate', 'rate include breakfast',
             'price include breakfast', 'part of the booking', 'included in my stay',
             'doručak uključen', 'dorucak ukljucen', 'uključuje li cijena doručak',
             'ukljucuje li cijena dorucak', 'je li doručak uključen', 'je li dorucak ukljucen'],
      note: 'pre_router_breakfast_included' },
    { keys: ['breakfast', 'doručak', 'dorucak', 'buffet', 'a la carte', 'kids breakfast'], note: 'pre_router_breakfast' },
    { keys: ['transfer', 'airport', 'zračna luka', 'zracna luka', 'pickup', 'shuttle'], note: 'pre_router_transfer' },
    { keys: ['taxi', 'uber'], note: 'pre_router_taxi_uber' },
    { keys: ['directions', 'how to get', 'upute', 'dolazak', 'arrival guidance'], note: 'pre_router_directions' },
    { keys: ['city tax', 'tourist tax', 'boravišna', 'boravisna', 'tax'], note: 'pre_router_city_tax' },
    { keys: ['r1', 'invoice', 'račun', 'racun'], note: 'pre_router_invoice' },
  ];

  for (const b of buckets) {
    if (!b.keys.some(k => q.includes(normalizeText(k)))) continue;
    const p = findPatternByKeyword(patterns, b.keys);
    if (p?.intent) {
      return { intent: p.intent, confidence: 0.92, outputScope: p.outputScope || 'General', note: b.note };
    }
  }

  return null;
}

function heuristicChooseIntent(question, patterns) {
  const qTokens = tokensWithSynonyms(question);
  if (!qTokens.length) return { intent: null, confidence: 0, outputScope: 'General', note: 'heuristic_no_tokens' };

  let best = { intent: null, score: 0, outputScope: 'General' };

  for (const p of patterns) {
    const phrases = String(p.phrases || '');
    const hay = normalizeText(`${p.intent} ${phrases}`);
    let score = 0;

    for (const t of qTokens) {
      if (t.length < 3) continue;
      if (hay.includes(t)) score += 1;
    }

    // mala prednost ako intent “ključna riječ” direktno postoji
    if (p.intent && normalizeText(p.intent).includes(qTokens[0] || '')) score += 0.25;

    if (score > best.score) best = { intent: p.intent, score, outputScope: p.outputScope || 'General' };
  }

  if (best.score >= 2) {
    return { intent: best.intent, confidence: Math.min(0.85, 0.55 + best.score * 0.05), outputScope: best.outputScope, note: 'heuristic_match' };
  }
  return { intent: null, confidence: 0, outputScope: 'General', note: 'heuristic_no_match' };
}

async function chooseIntent(question, patterns) {
  if (!patterns.length) return { intent: null, confidence: 0, note: 'no_patterns', outputScope: 'General' };

  // ✅ pre-router (deterministički) prije GPT-a
  const pre = preRouteIntent(question, patterns);
  if (pre?.intent) return pre;

  const validIntents = new Set(patterns.map(p => String(p.intent)));

  const compact = patterns.map(p => ({
    intent: p.intent,
    phrases: (p.phrases || '').slice(0, 240),
    outputScope: p.outputScope || 'General',
  }));

  const sys = `You are an intent router for a HOTEL WEB CHAT WIDGET.
Pick exactly one intent from the provided list if it clearly matches the user's question.
If none match, return null.
Return JSON only with keys: intent, confidence (0-1), outputScope, note.`;

  const payload = { question, intents: compact };

  try {
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = resp.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    let intent = (typeof parsed.intent === 'string' && parsed.intent.trim()) ? parsed.intent.trim() : null;
    const confidence = Number(parsed.confidence ?? 0);
    const outputScope = (typeof parsed.outputScope === 'string' && parsed.outputScope.trim()) ? parsed.outputScope.trim() : 'General';

    if (intent && !validIntents.has(intent)) intent = null;

    // Heuristic fallback ako je “mlitavo”
    if (!intent || confidence < 0.35) {
      const h = heuristicChooseIntent(question, patterns);
      if (h.intent) return h;
    }

    return { intent, confidence, outputScope, note: parsed.note || '' };
  } catch (e) {
    console.error('chooseIntent error:', e);
    // fallback heuristic (bez OpenAI)
    const h = heuristicChooseIntent(question, patterns);
    if (h.intent) return h;
    return { intent: null, confidence: 0, outputScope: 'General', note: 'intent_router_failed' };
  }
}

// -------------------------
// HOTELI + SERVICES + SOBE
// -------------------------
async function getHotelRecord(hotelSlug) {
  const cached = CACHE.hotelBySlug.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts)) return cached.row;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  let rec = await airtableSelectFirst(TABLE_HOTELS, {
    pageSize: 1,
    maxRecords: 1,
    filterByFormula: `{Slug}='${slugEsc}'`,
  });

  if (!rec) {
    const all = await airtableSelectAll(TABLE_HOTELS, { pageSize: 100 });
    rec = all.find(r => {
      const f = r.fields || {};
      return String(f.Slug ?? f.slug ?? '') === String(hotelSlug);
    }) || null;
  }

  const f = rec?.fields || {};

  // ✅ IMPORTANT: mapiraj stvarna imena polja koja imaš u HOTELI tablici
  const row = rec ? {
    id: rec.id,
    hotelNaziv: pickFirstNonEmpty(f['Hotel naziv'], f.Naziv, f.Name),
    slug: pickFirstNonEmpty(f.Slug, f.slug),
    opis: pickFirstNonEmpty(f['Opis (kratki)'], f.Opis, f.opis),

    grad: pickFirstNonEmpty(f.Grad, f.grad),
    postanskiBroj: pickFirstNonEmpty(String(f['Poštanski broj'] ?? ''), String(f.PostanskiBroj ?? ''), String(f.postanski_broj ?? '')),

    adresa: pickFirstNonEmpty(f.Adresa, f.adresa),

    // telefon / email (više varijanti naziva)
    telefon: pickFirstNonEmpty(
      f['Telefon (recepcija)'],
      f['Telefon recepcija'],
      f.Telefon,
      f.telefon,
      f.Phone,
      f['Phone Number']
    ),
    email: pickFirstNonEmpty(
      f['Email (recepcija)'],
      f['E-mail (recepcija)'],
      f.Email,
      f.email
    ),

    // core vremena
    checkIn: pickFirstNonEmpty(String(f['Check-in'] ?? ''), String(f.CheckIn ?? ''), String(f['Check in'] ?? '')),
    checkOut: pickFirstNonEmpty(String(f['Check-out'] ?? ''), String(f.CheckOut ?? ''), String(f['Check out'] ?? '')),

    // linkovi
    googleMaps: pickFirstNonEmpty(f['Google Maps'], f.GoogleMaps, f.maps),
    googleReview: pickFirstNonEmpty(f['Google Review'], f.GoogleReview, f.review),
    instagram: pickFirstNonEmpty(f.Instagram, f.instagram),
    web: pickFirstNonEmpty(f.Web, f.web),

    // parking (ako ga ima u hotel tablici)
    parking: pickFirstNonEmpty(f.Parking, f.parking),

    // WhatsApp URL — wa.me link for the hotel's WhatsApp contact.
    // Field must be created manually in Airtable (REST API cannot create fields).
    // Returns '' if field not yet populated; renderWhatsAppAnswer falls back to service Opis.
    whatsapp: pickFirstNonEmpty(f['WhatsApp'], f['WhatsApp URL'], f.Whatsapp, f.whatsapp, ''),

    // Persona voice — hotel-specific tone injected into every GPT call.
    // Field must be created manually in Airtable (REST API cannot create fields).
    // Returns '' if field not yet populated; generateAnswer gracefully skips it.
    personaVoice: pickFirstNonEmpty(f['Persona Voice'], f.personaVoice, ''),

    // Notification email — recipient for AI OLLY guest request alert emails.
    // Set per-hotel in the HOTELI table "Notification Email" field.
    // Returns '' if not set; notification is silently skipped.
    notificationEmail: pickFirstNonEmpty(f['Notification Email'], f.notificationEmail, ''),

    // Emergency numbers — tenant-configurable. Fallback to EU standard (112/194) if not set.
    emergencyNumber:        pickFirstNonEmpty(f['Emergency Number'],        f.emergencyNumber,        '112'),
    medicalEmergencyNumber: pickFirstNonEmpty(f['Medical Emergency Number'], f.medicalEmergencyNumber, '194'),

    active: (f.Active ?? true) === true,
  } : null;

  const finalRow = (row && row.active) ? row : null;

  CACHE.hotelBySlug.set(String(hotelSlug), { ts: Date.now(), row: finalRow });
  return finalRow;
}

// ✅ izvuci hotel slug iz različitih naziva polja (sigurnije)
function getHotelSlugRaw(fields) {
  const f = fields || {};
  return (
    f['Hotel Slug (text)'] ??
    f['Hotel Slug (Text)'] ??
    f['Hotel Slug text'] ??
    f['Hotel Slug'] ??
    f.HotelSlug ??
    f.hotel_slug ??
    null
  );
}

// ---- MAPPERS (da možemo mapirati i linked-find recorde) ----
function mapServiceRecord(r) {
  const f = r?.fields || {};
  return {
    type: 'SERVICE',
    id: r.id,
    naziv: pickFirstNonEmpty(f['Naziv usluge'], f.Naziv, f.Name, f.Title, f.naziv),
    kategorija: asArray(f.Kategorija ?? f.kategorija),
    opis: pickFirstNonEmpty(f.Opis, f.opis),
    radnoVrijeme: pickFirstNonEmpty(f['Radno vrijeme'], f.Radno, f.radno_vrijeme),
    aiPrompt: pickFirstNonEmpty(f['AI_PROMPT  '], f.AI_PROMPT, f.ai_prompt), // Fix #4c: field has two trailing spaces in Airtable
    aiIntent: asArray(f.AI_INTENT ?? f.ai_intent),
    aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
    hotelSlugRaw: getHotelSlugRaw(f),
    active: (f.Active ?? true) === true,
  };
}

function mapRoomRecord(r) {
  const f = r?.fields || {};
  return {
    type: 'ROOM',
    id: r.id,
    naziv: pickFirstNonEmpty(f['Naziv sobe'], f['Soba oznaka'], f.Naziv, f.Name),
    tipSobe: pickFirstNonEmpty(f['Kategorija sobe'], f['Tip sobe'], f.Tip, f.tip),
    slug: pickFirstNonEmpty(f.Slug, f.slug),
    opis: pickFirstNonEmpty(f['Opis sobe'], f.Opis, f.opis),

    // ✅ polja (uključujući stvarno “View” iz tvoje tablice)
    kapacitet: f['Kapacitet (osoba)'] ?? f.Kapacitet ?? f.kapacitet ?? null,
    kvadratura: f.Kvadratura ?? f.kvadratura ?? null,
    kat: f.Kat ?? f.kat ?? null,

    // “View”/“Pogled” (pokrivamo obje varijante)
    pogled: f.View ?? f['View'] ?? f.Pogled ?? f.pogled ?? null,

    kreveti: asArray(f["Bed's"] ?? f.Beds ?? f.Kreveti ?? f.kreveti),
    roomAmenities: asArray(f['Room Amenities'] ?? f['Room amenities'] ?? f.room_amenities ?? f['Room Amenities (sadržaj sobe)']),

    aiPrompt: pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt),
    aiIntent: asArray(f.AI_INTENT ?? f.ai_intent),
    aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
    hotelSlugRaw: getHotelSlugRaw(f),
    active: (f.Active ?? true) === true,
  };
}

async function getServicesForHotelWeb(hotelSlug) {
  const cached = CACHE.servicesByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  // pokušaj prvo s “Hotel Slug (text)”, pa s “Hotel Slug”, pa fallback na all
  const recs = await airtableSelectAllSafe(
    TABLE_SERVICES,
    [
      { pageSize: 100, filterByFormula: `{Hotel Slug (text)}='${slugEsc}'` },
      { pageSize: 100, filterByFormula: `{Hotel Slug}='${slugEsc}'` },
    ]
    // bez fallbacka — ako oba filtera promašuju, vraćamo [], ne sve zapise
  );

  const rows = recs.map(mapServiceRecord);

  const webRows = rows.filter(r =>
    r.active &&
    matchesHotelSlug(r.hotelSlugRaw, hotelSlug) &&
    allowForWeb(r.aiSource)
  );

  CACHE.servicesByHotel.set(String(hotelSlug), { ts: Date.now(), rows: webRows });
  return webRows;
}

async function getRoomsForHotelWeb(hotelSlug) {
  const cached = CACHE.roomsByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  const recs = await airtableSelectAllSafe(
    TABLE_ROOMS,
    [
      { pageSize: 100, filterByFormula: `{Hotel Slug (text)}='${slugEsc}'` },
      { pageSize: 100, filterByFormula: `{Hotel Slug}='${slugEsc}'` },
    ]
    // bez fallbacka — ako oba filtera promašuju, vraćamo [], ne sve zapise
  );

  const rows = recs.map(mapRoomRecord);

  const webRows = rows.filter(r =>
    r.active &&
    matchesHotelSlug(r.hotelSlugRaw, hotelSlug) &&
    allowForWeb(r.aiSource)
  );

  CACHE.roomsByHotel.set(String(hotelSlug), { ts: Date.now(), rows: webRows });
  return webRows;
}

// Fetch ALL rooms for a hotel without any AI_SOURCE filter — for room type lookup.
// Uses three fallback levels: filtered by slug text field, filtered by linked slug,
// then all records (filtered in JS). This handles both text and linked Hotel Slug fields.
async function getRoomsRaw(hotelSlug) {
  const cacheKey = 'raw:' + hotelSlug;
  const cached   = CACHE.roomsByHotel.get(cacheKey);
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  // Try filtered queries first; fall back to fetching all (filter in JS)
  const recs = await airtableSelectAllSafe(
    TABLE_ROOMS,
    [
      { pageSize: 100, filterByFormula: `{Hotel Slug (text)}='${slugEsc}'` },
      { pageSize: 100, filterByFormula: `{Hotel Slug}='${slugEsc}'`        },
    ],
    { pageSize: 100 } // fallback: all rooms — filter in JS below
  );

  const allRows  = recs.map(mapRoomRecord);
  // If we used the fallback (no slug filter), narrow by hotelSlug in JS
  const rows     = allRows.filter(r =>
    !r.hotelSlugRaw?.length || matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
  );

  const result = rows.length ? rows : allRows; // last resort: return all if nothing matched
  if (result.length > 0) CACHE.roomsByHotel.set(cacheKey, { ts: Date.now(), rows: result });
  return result;
}

// -------------------------
// PWA: SERVICES loader — AI_SOURCE=PWA or BOTH
// -------------------------
async function getServicesForHotelPwa(hotelSlug) {
  const cached = CACHE.pwaServicesByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  const recs = await airtableSelectAllSafe(
    TABLE_SERVICES,
    [
      { pageSize: 100, filterByFormula: `{Hotel Slug (text)}='${slugEsc}'` },
      { pageSize: 100, filterByFormula: `{Hotel Slug}='${slugEsc}'` },
    ]
  );

  const rows = recs.map(mapServiceRecord).filter(r =>
    r.active &&
    matchesHotelSlug(r.hotelSlugRaw, hotelSlug) &&
    allowForPWA(r.aiSource)
  );

  CACHE.pwaServicesByHotel.set(String(hotelSlug), { ts: Date.now(), rows });
  return rows;
}

// -------------------------
// PWA: ROOM GUIDE loader
// Maps one ROOM GUIDE record to a usable object.
// -------------------------
function mapRoomGuideRecord(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    type: 'ROOM_GUIDE',
    naziv: pickFirstNonEmpty(f['Naziv sobe'], ''),
    tipSobe: pickFirstNonEmpty(f['Room Type'], ''),
    wifi: pickFirstNonEmpty(f.WiFi, ''),
    klimaUpute: pickFirstNonEmpty(f['Upute Klima'], ''),
    tvUpute: pickFirstNonEmpty(f['Upute TV'], ''),
    sefUpute: pickFirstNonEmpty(f['Upute Sef'], ''),
    napomene: pickFirstNonEmpty(f.Napomene, ''),
    aiWelcome: pickFirstNonEmpty(f['AI WELCOME'], ''),
    roomFeatures: pickFirstNonEmpty(f['Room features/Communication'], ''),
    aiMasterPrompt: pickFirstNonEmpty(f['AI Master prompt'], ''),
    qrLink: pickFirstNonEmpty(f['QR LINK'], ''),
    // Access token — set per check-in, cleared at check-out.
    // Field 'Access Token' must be created manually in Airtable (singleLineText).
    accessToken: pickFirstNonEmpty(f['Access Token'], f.accessToken, ''),
    hotelSlugRaw: asArray(f['Hotel Slug'] ?? []),
    active: (f.Active ?? true) === true,
  };
}

// Loads all ROOM GUIDE records for a hotel (cached by hotelSlug).
// Filters via FIND on the Hotel Slug lookup field.
// Returns [] if hotel has no room guide records — never returns all hotels' records.
async function getRoomGuideByHotel(hotelSlug) {
  const cached = CACHE.roomGuideByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  const recs = await airtableSelectAllSafe(
    TABLE_ROOM_GUIDE,
    [
      { pageSize: 100, filterByFormula: `FIND("${slugEsc}", ARRAYJOIN({Hotel Slug}))` },
    ]
    // no fallback — if filter misses, return [], never load all hotels' rooms
  );

  const rows = recs.map(mapRoomGuideRecord).filter(r => r.active);

  // Only cache non-empty results — an empty result may mean a transient Airtable
  // failure; caching it would poison every subsequent call for 60 s (→ 403).
  if (rows.length > 0) {
    CACHE.roomGuideByHotel.set(String(hotelSlug), { ts: Date.now(), rows });
  }
  return rows;
}

// Returns the ROOM GUIDE record for a specific room number string (e.g. "201"), or null.
async function getRoomGuideRecord(hotelSlug, roomNumber) {
  if (!roomNumber) return null;
  const all = await getRoomGuideByHotel(hotelSlug);
  const target = String(roomNumber).trim();
  return all.find(r => String(r.naziv).trim() === target) ?? null;
}

// -------------------------
// Better fallback scoring (services + rooms)
// + domain override (parking/breakfast/minibar => SERVICE; view/UNESCO => ROOM)
// -------------------------
function buildRecordHaystack(r) {
  return normalizeText([
    r.type,
    r.naziv,
    r.tipSobe,
    r.slug,
    (Array.isArray(r.kategorija) ? r.kategorija.join(' ') : ''),
    (Array.isArray(r.kreveti) ? r.kreveti.join(' ') : ''),
    (Array.isArray(r.roomAmenities) ? r.roomAmenities.join(' ') : ''),
    (r.pogled ? String(r.pogled) : ''),
    (r.kat ? String(r.kat) : ''),
    (r.kvadratura ? String(r.kvadratura) : ''),
    (r.kapacitet ? String(r.kapacitet) : ''),
    r.opis,
    r.radnoVrijeme,
    (Array.isArray(r.aiIntent) ? r.aiIntent.join(' ') : ''),
  ].join(' '));
}

function inferDomain(question) {
  const q = normalizeText(question);
  if (q.includes('parking') || q.includes('parkiranje') || q.includes('rampa') || q.includes('taxi') || q.includes('uber')) return 'SERVICE';
  if (q.includes('breakfast') || q.includes('doruč') || q.includes('doruc') || q.includes('minibar') || q.includes('mini bar') || q.includes('laundry') || q.includes('dry cleaning')) return 'SERVICE';
  if (q.includes('smoking') || q.includes('non smoking') || q.includes('pušen') || q.includes('pusen')) return 'SERVICE';
  if (q.includes('view') || q.includes('unesco') || q.includes('palace') || q.includes('peristil') || q.includes('pogled') || q.includes('cathedral')) return 'ROOM';
  if (q.includes('amenities') || q.includes('oprema') || q.includes('sadržaj') || q.includes('sadrzaj') || q.includes('bed') || q.includes('krevet')) return 'ROOM';
  return 'ANY';
}

function pickFallbackRecords(question, allRecords, limit = 3) {
  const qTokens = tokensWithSynonyms(question);
  if (!qTokens.length) return [];

  const qNorm = normalizeText(question);
  const dom = inferDomain(question);

  const scored = allRecords.map(r => {
    const hay = buildRecordHaystack(r);

    let score = 0;

    // token overlaps
    for (const t of qTokens) {
      if (t.length < 3) continue;
      if (hay.includes(t)) score += 1;
    }

    // phrase contains boost (kad user upiše baš naziv usluge/sobe)
    const nameNorm = normalizeText(r.naziv || '');
    if (nameNorm && qNorm.includes(nameNorm) && nameNorm.length >= 4) score += 3;

    // type boost / penalty by inferred domain
    if (dom === 'ROOM') {
      if (r.type === 'ROOM') score += 1.0;
      if (r.type === 'SERVICE') score -= 0.5;
    }
    if (dom === 'SERVICE') {
      if (r.type === 'SERVICE') score += 1.0;
      if (r.type === 'ROOM') score -= 0.5;
    }

    return { r, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.filter(x => x.score > 0);
  return top.slice(0, limit).map(x => x.r);
}

async function fetchKnowledgeRows({ hotelSlug, intent, question }) {
  const [hotelRec, services, rooms] = await Promise.all([
    getHotelRecord(hotelSlug),
    getServicesForHotelWeb(hotelSlug),
    getRoomsForHotelWeb(hotelSlug),
  ]);

  const all = [...services, ...rooms];

  const matched = intent
    ? all.filter(r => asArray(r.aiIntent).map(String).includes(String(intent)))
    : [];

  const fallback = (!matched.length)
    ? pickFallbackRecords(question, all, 3)
    : [];

  return { hotelRec, services, rooms, matched, fallback, all };
}

// -------------------------
// Deterministic answers (no hallucinations)
// -------------------------
function renderRoomTypesAnswer(rooms, lang = 'HR') {
  if (!rooms?.length) {
    return lang === 'EN'
      ? 'I don’t have room-type details in the system right now. Please contact reception for exact information.'
      : 'Nemam podatke o vrstama soba u sustavu. Molim kontaktirajte recepciju za točne informacije.';
  }

  const lines = rooms
    .map(r => {
      const name = r.naziv || r.tipSobe || r.slug || 'Room';
      const tip = r.tipSobe ? ` — ${r.tipSobe}` : '';
      const view = r.pogled ? ` — view: ${String(r.pogled)}` : '';
      const beds = (r.kreveti && r.kreveti.length) ? ` — beds: ${r.kreveti.join(', ')}` : '';
      return `• ${name}${tip}${view}${beds}`;
    })
    .slice(0, 20);

  return lang === 'EN'
    ? `These are the room types listed:\n${lines.join('\n')}`
    : `Imamo sljedeće vrste soba:\n${lines.join('\n')}`;
}

function renderNoInfo(lang = 'HR') {
  return lang === 'EN'
    ? `I don’t have that information in the system. Please contact reception for exact details.`
    : `Nemam taj podatak u sustavu. Molim kontaktirajte recepciju za točne informacije.`;
}

/// ✅ deterministički: radno vrijeme doručka
// Fix #7: extracts the Radno vrijeme field from the Breakfast (Hours & Policy)
// service record. Normalises "7:30 AM to 10:30 AM" → language-appropriate format.
// Returns null if no breakfast record with a radnoVrijeme value is found —
// caller falls through to GPT (graceful degradation, no hard stop).
function parseTimeRange(raw) {
  // Parse "H:MM [AM|PM] to H:MM [AM|PM]" into a [from, to] pair in 24-hour format.
  // AM hours are returned unchanged.  PM hours (except 12:xx PM) are shifted +12.
  // Examples:
  //   "7:30 AM to 10:30 AM" → ["7:30",  "10:30"]  (breakfast — all AM, unchanged)
  //   "8:00 AM to 2:00 PM"  → ["8:00",  "14:00"]  (housekeeping — PM end converted)
  const parts = String(raw || '').split(/\s+to\s+/i);
  if (parts.length !== 2) return null;

  function to24h(segment) {
    const seg = segment.trim();
    const isPM = /PM/i.test(seg);
    const time = seg.replace(/\s*[AP]M/gi, '').trim();
    if (!isPM) return time;
    const [h, m] = time.split(':').map(Number);
    const hour24 = h === 12 ? 12 : h + 12;
    return `${hour24}:${String(m || 0).padStart(2, '0')}`;
  }

  return [to24h(parts[0]), to24h(parts[1])];
}

function renderBreakfastHoursAnswer(services, lang = 'HR') {
  const rec = (services || []).find(r =>
    normalizeText(r.naziv || '').includes('breakfast') && r.radnoVrijeme
  );
  if (!rec?.radnoVrijeme) return null;

  const parsed = parseTimeRange(rec.radnoVrijeme);
  if (!parsed) return null;
  const [from, to] = parsed;

  return lang === 'EN'
    ? `Breakfast is served from ${from} to ${to}.`
    : `Doručak se poslužuje od ${from} do ${to}.`;
}

// ✅ deterministički: radno vrijeme domaćinstva (housekeeping)
// Fix #8: same pattern as breakfast hours. parseTimeRange converts
// "8:00 AM to 2:00 PM" → ["8:00", "14:00"] via PM→24h shift.
// Returns null if no housekeeping record with radnoVrijeme is found —
// caller falls through to GPT (graceful degradation, no hard stop).
function renderHousekeepingHoursAnswer(services, lang = 'HR') {
  const rec = (services || []).find(r =>
    normalizeText(r.naziv || '').includes('housekeeping') && r.radnoVrijeme
  );
  if (!rec?.radnoVrijeme) return null;

  const parsed = parseTimeRange(rec.radnoVrijeme);
  if (!parsed) return null;
  const [from, to] = parsed;

  return lang === 'EN'
    ? `Housekeeping is available from ${from} to ${to}.`
    : `Čišćenje sobe dostupno je od ${from} do ${to}.`;
}

// ✅ deterministički: WiFi pristup i lozinka (Fix #9)
// The Complimentary WiFi Opis is already guest-ready (availability + network +
// password). Returned verbatim — no language-specific template needed since
// the network name and password are proper nouns identical in all languages.
// Returns null if no WiFi record found — caller falls through to GPT.
function renderWifiAnswer(services) {
  const rec = (services || []).find(r =>
    normalizeText(r.naziv || '').includes('wifi')
  );
  if (!rec?.opis) return null;
  return rec.opis.trim();
}

// ✅ deterministički: politika kućnih ljubimaca (Fix #10)
// The Pet Policy (No Pets) Opis is a single definitive sentence. Returned
// verbatim — the English text is appropriate for both EN and HR contexts since
// it is a formal policy statement. Returns null if record not found or inactive.
function renderPetPolicyAnswer(services) {
  const rec = (services || []).find(r =>
    normalizeText(r.naziv || '').includes('pet')
  );
  if (!rec?.opis) return null;
  return rec.opis.trim();
}

// ✅ deterministički: kontakt / maps / check-in-out
function renderHotelCoreAnswer(hotelRec, lang = 'HR') {
  if (!hotelRec) return renderNoInfo(lang);

  const parts = [];

  // name + address
  if (hotelRec.hotelNaziv) parts.push(lang === 'EN' ? `${hotelRec.hotelNaziv}` : `${hotelRec.hotelNaziv}`);
  if (hotelRec.adresa) parts.push(lang === 'EN' ? `Address: ${hotelRec.adresa}` : `Adresa: ${hotelRec.adresa}`);

  // phone/email
  if (hotelRec.telefon) parts.push(lang === 'EN' ? `Reception phone: ${hotelRec.telefon}` : `Telefon (recepcija): ${hotelRec.telefon}`);
  if (hotelRec.email) parts.push(lang === 'EN' ? `Email: ${hotelRec.email}` : `Email: ${hotelRec.email}`);

  // checkin/checkout
  if (hotelRec.checkIn) parts.push(lang === 'EN' ? `Check-in: ${hotelRec.checkIn}` : `Check-in: ${hotelRec.checkIn}`);
  if (hotelRec.checkOut) parts.push(lang === 'EN' ? `Check-out: ${hotelRec.checkOut}` : `Check-out: ${hotelRec.checkOut}`);

  // links (keep as-is)
  if (hotelRec.googleMaps) parts.push(lang === 'EN' ? `Google Maps: ${hotelRec.googleMaps}` : `Google Maps: ${hotelRec.googleMaps}`);
  if (hotelRec.googleReview) parts.push(lang === 'EN' ? `Google Reviews: ${hotelRec.googleReview}` : `Google recenzije: ${hotelRec.googleReview}`);
  if (hotelRec.instagram) parts.push(lang === 'EN' ? `Instagram: ${hotelRec.instagram}` : `Instagram: ${hotelRec.instagram}`);
  if (hotelRec.web) parts.push(lang === 'EN' ? `Website: ${hotelRec.web}` : `Web: ${hotelRec.web}`);

  if (!parts.length) return renderNoInfo(lang);

  return parts.join('\n');
}

// ✅ deterministički: focused hotel info — picks only the field the guest asked about
// Replaces full renderHotelCoreAnswer for contact/address/social questions so the
// guest gets a one-liner instead of a 8-line card dump.
//
// Signal priority (first match wins):
//   phone / call / contact  → phone number only
//   email                   → email only
//   address / where / map   → address + Google Maps
//   instagram               → Instagram link
//   website / web           → website link
//   (no focused signal)     → fall back to full renderHotelCoreAnswer
function renderFocusedHotelCoreAnswer(hotelRec, question, lang = 'HR') {
  if (!hotelRec) return renderNoInfo(lang);

  const q = normalizeText(question);

  // Email — checked FIRST because "contact by email" contains 'contact' which would
  // otherwise match the phone/contact block below, returning the wrong field.
  if (q.includes('email') || q.includes('e mail') || q.includes('mail')) {
    const email = hotelRec.email;
    if (!email) return renderNoInfo(lang);
    return lang === 'EN'
      ? `You can contact us at ${email}`
      : `Možete nas kontaktirati na ${email}`;
  }

  // Phone / contact
  if (
    q.includes('phone')    || q.includes('call')    || q.includes('telefon') ||
    q.includes('nazovit')  || q.includes('broj')    || q.includes('contact') ||
    q.includes('kontakt')  || q.includes('reach')   || q.includes('reception phone')
  ) {
    const phone = hotelRec.telefon;
    if (!phone) return renderNoInfo(lang);
    return lang === 'EN'
      ? `You can reach us at ${phone}`
      : `Možete nas dosegnuti na ${phone}`;
  }

  // Address / location / map
  if (
    q.includes('address')  || q.includes('adresa')  || q.includes('located') ||
    q.includes('location') || q.includes('where is') || q.includes('gdje je') ||
    q.includes('map')      || q.includes('karta')    || q.includes('how to get') ||
    q.includes('directions')
  ) {
    const parts = [];
    if (hotelRec.adresa)      parts.push(lang === 'EN' ? `Address: ${hotelRec.adresa}` : `Adresa: ${hotelRec.adresa}`);
    if (hotelRec.googleMaps)  parts.push(lang === 'EN' ? `Google Maps: ${hotelRec.googleMaps}` : `Google Maps: ${hotelRec.googleMaps}`);
    return parts.length ? parts.join('\n') : renderNoInfo(lang);
  }

  // Instagram
  if (q.includes('instagram') || q.includes('social media') || q.includes('follow')) {
    const ig = hotelRec.instagram;
    if (!ig) return renderNoInfo(lang);
    return lang === 'EN'
      ? `Instagram: ${ig}`
      : `Instagram: ${ig}`;
  }

  // Website
  if (q.includes('website') || q.includes('web stranica') || q.includes(' web ') || q.includes('homepage') || q.includes('url')) {
    const web = hotelRec.web;
    if (!web) return renderNoInfo(lang);
    return lang === 'EN'
      ? `Website: ${web}`
      : `Web: ${web}`;
  }

  // No focused signal — return full card
  return renderHotelCoreAnswer(hotelRec, lang);
}

// ✅ deterministički: WhatsApp kontakt
// Hard guard — always returns WA link when available, never lets GPT say “no WhatsApp”.
// Priority: 1) hotelRec.whatsapp field, 2) wa.me URL found in any service Opis,
//           3) graceful fallback to reception contact.
// Works for both /api/web-ask and /api/pwa-ask.
function renderWhatsAppAnswer(hotelRec, services, lang) {
  // Priority 1: dedicated WhatsApp field on hotel record (set in Airtable HOTELI)
  const waFromHotel = (hotelRec?.whatsapp || '').trim();
  if (waFromHotel) {
    const url = waFromHotel.startsWith('http') ? waFromHotel : `https://wa.me/${waFromHotel}`;
    return lang === 'EN'
      ? `Feel free to contact us on WhatsApp: ${url}`
      : `Slobodno nas kontaktirajte putem WhatsAppa: ${url}`;
  }

  // Priority 2: wa.me URL embedded in any active service record Opis
  for (const r of (services || [])) {
    const match = (r.opis || '').match(/https?:\/\/wa\.me\/\S+/);
    if (match) {
      return lang === 'EN'
        ? `Feel free to contact us on WhatsApp: ${match[0]}`
        : `Slobodno nas kontaktirajte putem WhatsAppa: ${match[0]}`;
    }
  }

  // Fallback: no WA data found — direct to reception
  const phone = hotelRec?.telefon;
  return lang === 'EN'
    ? `For direct assistance, please contact Reception${phone ? ` at ${phone}` : ''}.`
    : `Za izravnu pomoć, kontaktirajte recepciju${phone ? ` na broju ${phone}` : ''}.`;
}

// ✅ deterministički (PWA only): concise check-in/out timing answer
// Used when guest asks specifically “what time is check-in/out?” — avoids returning
// the full hotel card (which includes social media links) for a simple timing question.
function renderCheckinTimeAnswer(hotelRec, lang = 'HR') {
  if (!hotelRec) return renderNoInfo(lang);
  const ci = hotelRec.checkIn  || (lang === 'EN' ? 'not specified' : 'nije navedeno');
  const co = hotelRec.checkOut || (lang === 'EN' ? 'not specified' : 'nije navedeno');
  return lang === 'EN'
    ? `Check-in: ${ci}. Check-out: ${co}. For early check-in or late check-out requests, please contact Reception.`
    : `Prijava: ${ci}. Odjava: ${co}. Za ranu prijavu ili kasnu odjavu, obratite se recepciji.`;
}

// ✅ deterministički (PWA only): emergency / medical / fire
// Returns reception phone + tenant emergency numbers immediately.
// Numbers come from HOTELI Emergency Number / Medical Emergency Number fields.
// Fallback: 112 (general) / 194 (ambulance) — EU/Croatia standard.
function renderEmergencyAnswer(hotelRec, lang = 'HR', question = '') {
  const phone  = hotelRec?.telefon;
  const emNum  = (hotelRec?.emergencyNumber        || '112').trim();
  const medNum = (hotelRec?.medicalEmergencyNumber || '194').trim();

  const phoneLine = phone
    ? (lang === 'EN' ? ` Reception: ${phone}.` : ` Recepcija: ${phone}.`)
    : '';

  // Fire / evacuation branch — detected from the raw question string
  const qn = String(question || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const isFireRelated = (
    qn.includes('fire')          ||
    qn.includes('požar')         ||
    qn.includes('pozar')         ||
    qn.includes('evacuat')       ||
    qn.includes('evakuacij')     ||
    qn.includes('fire exit')     ||
    qn.includes('požarni izlaz') ||
    qn.includes('pozarni izlaz')
  );

  if (isFireRelated) {
    return lang === 'EN'
      ? `If there is a fire or immediate danger, stay calm and leave the building immediately using the nearest safe exit. Follow any instructions from hotel staff.${phoneLine} Call ${emNum} for all emergencies, or ${medNum} for ambulance assistance. Contact Reception for guidance if it is safe to do so.`
      : `U slučaju požara ili neposredne opasnosti, ostanite mirni i napustite zgradu odmah koristeći najbliži siguran izlaz. Slijedite upute hotelskog osoblja.${phoneLine} Nazovite ${emNum} za sve hitne slučajeve, ili ${medNum} za hitnu medicinsku pomoć. Ako je sigurno, kontaktirajte recepciju za smjernice.`;
  }

  return lang === 'EN'
    ? `Please contact Reception immediately for urgent assistance.${phoneLine} For medical emergencies call ${medNum} (ambulance). For all emergencies call ${emNum}.`
    : `Molimo odmah kontaktirajte recepciju za hitnu pomoć.${phoneLine} Za hitnu medicinsku pomoć nazovite ${medNum}. Za sve hitne slučajeve nazovite ${emNum}.`;
}

// ✅ deterministički (PWA only): city/activity hint — points guest to app features
// Used when guest asks about local attractions, sightseeing, or excursions.
// The PWA has City Map and Routes sections that serve this need directly.
function renderCityActivityHint(lang = 'HR') {
  return lang === 'EN'
    ? `For local attractions and walks, check the City Map and Routes sections in your guide — they include curated walks and points of interest near the hotel. For personal recommendations, contact Reception.`
    : `Za lokalne atrakcije i šetnje, pogledajte Kartu grada i Rute u vodiču — tamo ćete naći predložene rute i zanimljiva mjesta u blizini hotela. Za osobne preporuke, obratite se recepciji.`;
}

// ✅ deterministički: “Which rooms have UNESCO/Palace view?”
function renderRoomsByViewAnswer(rooms, question, lang = 'HR') {
  const q = normalizeText(question);
  const viewNeedles = [];

  if (q.includes('unesco')) viewNeedles.push('unesco');
  if (q.includes('palace') || q.includes('palač')) viewNeedles.push('palace', 'pala');
  if (q.includes('peristil')) viewNeedles.push('peristil');
  if (q.includes('cathedral') || q.includes('katedr')) viewNeedles.push('cathedral', 'kated');

  // fallback: ako nije eksplicitno, ali pita za “view”
  if (!viewNeedles.length) viewNeedles.push('view', 'pogled');

  const matched = (rooms || []).filter(r => {
    const v = normalizeText(String(r.pogled || ''));
    if (!v) return false;
    return viewNeedles.some(n => v.includes(normalizeText(n)));
  });

  if (!matched.length) {
    return lang === 'EN'
      ? `I don’t have a complete list of rooms with that view in the system. Please contact reception for confirmation.`
      : `Nemam kompletan popis soba s traženim pogledom u sustavu. Molim kontaktirajte recepciju za potvrdu.`;
  }

  const lines = matched.slice(0, 20).map(r => {
    const name = r.naziv || r.tipSobe || r.slug || 'Room';
    const view = r.pogled ? String(r.pogled) : '-';
    return `• ${name} — ${view}`;
  });

  return lang === 'EN'
    ? `Rooms with the requested view (as listed):\n${lines.join('\n')}`
    : `Sobe s traženim pogledom (kako je navedeno u sustavu):\n${lines.join('\n')}`;
}

// ---- room finders ----
function roomMatchScore(questionNorm, room) {
  const name = normalizeText(room.naziv || '');
  const tip = normalizeText(room.tipSobe || '');
  const slug = normalizeText(room.slug || '');
  let s = 0;

  if (name && questionNorm.includes(name)) s += 5;
  if (tip && questionNorm.includes(tip)) s += 4;
  if (slug && questionNorm.includes(slug)) s += 3;

  // partial keywords (bolje hvatanje "comfort ground room" -> "comfort ground floor")
  const q = questionNorm;
  const tokens = ['deluxe','superior','standard','comfort','ground','floor'];
  for (const w of tokens) {
    if (!q.includes(w)) continue;
    if (name.includes(w) || tip.includes(w) || slug.includes(w)) s += 1;
  }

  // posebna sinonomija
  if (q.includes('ground room') && (name.includes('ground') || tip.includes('ground') || slug.includes('ground'))) s += 1;
  if (q.includes('ground floor') && (name.includes('ground') || tip.includes('ground') || slug.includes('ground'))) s += 1;

  return s;
}

function findBestRoomMention(question, rooms) {
  const q = normalizeText(question);
  let best = null;
  let bestScore = 0;
  for (const r of rooms || []) {
    const s = roomMatchScore(q, r);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return (bestScore >= 3) ? best : null;
}

function splitIntoTwoRoomQueries(question) {
  const q = String(question || '');
  const lower = normalizeText(q);

  const separators = [
    ' vs ',
    ' versus ',
    ' and ',
    ' & ',
    ' u odnosu na ',
    ' razlika između ',
    ' razlika izmedu ',
    ' between ',
  ];

  for (const sep of separators) {
    if (lower.includes(normalizeText(sep))) {
      const parts = q.split(new RegExp(sep, 'i'));
      if (parts.length >= 2) {
        return [parts[0].trim(), parts[1].trim()];
      }
    }
  }
  return [q, ''];
}

function renderRoomAmenitiesForRoom(room, lang = 'HR') {
  const am = asArray(room?.roomAmenities).map(String).filter(Boolean);
  if (!room || !am.length) {
    return lang === 'EN'
      ? 'I don’t have a full amenities list for that room in the system. Please contact reception for details.'
      : 'Nemam kompletan popis sadržaja/opreme za tu sobu u sustavu. Molim kontaktirajte recepciju za detalje.';
  }
  const title = room.naziv || room.tipSobe || 'Room';
  const lines = am.slice(0, 50).map(x => `• ${x}`);
  return lang === 'EN'
    ? `Room amenities for ${title}:\n${lines.join('\n')}`
    : `Sadržaj/oprema sobe (${title}):\n${lines.join('\n')}`;
}

function renderRoomAmenitiesGeneral(rooms, lang = 'HR') {
  const all = new Set();
  for (const r of rooms || []) {
    for (const a of asArray(r.roomAmenities)) {
      const s = String(a || '').trim();
      if (s) all.add(s);
    }
  }
  const list = Array.from(all).slice(0, 50);
  if (!list.length) {
    return lang === 'EN'
      ? 'I don’t have a full amenities list in the system. Please contact reception for details.'
      : 'Nemam kompletan popis sadržaja/opreme u sustavu. Molim kontaktirajte recepciju za detalje.';
  }
  const lines = list.map(x => `• ${x}`);
  return lang === 'EN'
    ? `Room amenities (as listed):\n${lines.join('\n')}`
    : `Sadržaj/oprema soba (kako je navedeno u sustavu):\n${lines.join('\n')}`;
}

function renderBedTypesAnswer(rooms, lang = 'HR') {
  const lines = (rooms || [])
    .map(r => {
      const beds = asArray(r.kreveti).map(String).filter(Boolean);
      if (!beds.length) return null;
      const name = r.naziv || r.tipSobe || r.slug || 'Room';
      return `• ${name}: ${beds.join(', ')}`;
    })
    .filter(Boolean)
    .slice(0, 20);

  if (!lines.length) {
    return lang === 'EN'
      ? 'I don’t have bed-type details in the system. Please contact reception for exact information.'
      : 'Nemam podatke o tipu kreveta u sustavu. Molim kontaktirajte recepciju za točne informacije.';
  }

  return lang === 'EN'
    ? `Bed types (as listed):\n${lines.join('\n')}`
    : `Tipovi kreveta (kako je navedeno u sustavu):\n${lines.join('\n')}`;
}

function roomValueToText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).join(', ');
  return String(v).trim();
}

function renderRoomDifference(roomA, roomB, lang = 'HR') {
  if (!roomA || !roomB) {
    return lang === 'EN'
      ? 'I can compare rooms only if both room types are clearly identified. Please specify the two room names.'
      : 'Mogu usporediti sobe samo ako su obje jasno navedene. Molim napišite točno dvije sobe koje želite usporediti.';
  }

  const fields = [
    { key: 'tipSobe', labelHR: 'Tip sobe', labelEN: 'Room type' },
    { key: 'kvadratura', labelHR: 'Kvadratura', labelEN: 'Size (m²)' },
    { key: 'kapacitet', labelHR: 'Kapacitet', labelEN: 'Capacity' },
    { key: 'kat', labelHR: 'Kat', labelEN: 'Floor' },
    { key: 'pogled', labelHR: 'Pogled', labelEN: 'View' },
    { key: 'kreveti', labelHR: 'Kreveti', labelEN: 'Beds' },
  ];

  const nameA = roomA.naziv || roomA.tipSobe || 'Room A';
  const nameB = roomB.naziv || roomB.tipSobe || 'Room B';

  const diffs = [];
  for (const f of fields) {
    const a = roomValueToText(roomA[f.key]);
    const b = roomValueToText(roomB[f.key]);
    if (!a && !b) continue;

    const label = (lang === 'EN') ? f.labelEN : f.labelHR;
    const left = a || (lang === 'EN' ? 'not listed' : 'nije navedeno');
    const right = b || (lang === 'EN' ? 'not listed' : 'nije navedeno');

    if (a !== b) {
      diffs.push(`• ${label}: ${nameA} → ${left} | ${nameB} → ${right}`);
    }
  }

  if (!diffs.length) {
    return lang === 'EN'
      ? `I don’t have enough structured data to compare "${nameA}" and "${nameB}". Please contact reception for details.`
      : `Nemam dovoljno strukturiranih podataka za usporedbu "${nameA}" i "${nameB}". Molim kontaktirajte recepciju za detalje.`;
  }

  return lang === 'EN'
    ? `Key differences (${nameA} vs ${nameB}):\n${diffs.join('\n')}`
    : `Ključne razlike (${nameA} vs ${nameB}):\n${diffs.join('\n')}`;
}

// -------------------------
// ── GPT answer post-processor ────────────────────────────────────────────────
// Belt-and-suspenders cleanup: strip opening greetings and closing sign-offs
// that GPT sometimes adds despite system-prompt rules.
//
// Opening patterns stripped (first sentence/line if it is a greeting):
//   "Dobrodošli u vašu sobu. \n..."   "Welcome to your room! \n..."
//   "Hello! \n..."                    "Good morning! \n..."
//
// Closing patterns stripped (last sentence if it is a filler sign-off):
//   HR: "Trebate li pomoć?", "Slobodno se obratite...", "Stojim vam na..."
//   EN: "If you need anything...", "Feel free to...", "Let me know if...",
//       "I hope that helps.", "Is there anything else?", "Don't hesitate...",
//       "Happy to help."
//
// Only strips if remaining content is non-empty (never empties the answer).
// ─────────────────────────────────────────────────────────────────────────────
function stripChatWrap(answer) {
  if (!answer) return answer;
  let s = answer.trim();
  if (!s) return answer;

  // 1) Opening greeting removal
  // Matches a greeting sentence at the very start, followed by optional whitespace.
  // Only fires when there is more content after the greeting (prevents total erasure).
  const GREET = /^(Dobrodošl\w[^.!?\n]*[.!?]\s*\n*|Welcome\b[^.!?\n]*[.!?]\s*\n*|Hello\b[^.!?\n]*[.!?]\s*\n*|Good (?:morning|afternoon|evening)\b[^.!?\n]*[.!?]\s*\n*)/i;
  const gm = s.match(GREET);
  if (gm && s.length > gm[0].length) {
    s = s.slice(gm[0].length).trim();
  }

  // 2) Closing sign-off removal (iterative — strips multiple if stacked)
  // Terminal punctuation allows . ! ? , ; — GPT sometimes produces incomplete
  // trailing phrases ending with a comma ("Ako trebate pomoć s bilo čim,")
  const SIGN_OFFS = [
    // HR — "Trebate li X" is ALWAYS a sign-off at end of answer
    /\s*Trebate li [^\n]*[.!?,;]$/i,
    /\s*Slobodno (?:se )?(?:obratite|kontaktirajte)[^\n]*[.!?,;]$/i,
    /\s*Slobodno nam se javite[^\n]*[.!?,;]$/i,
    /\s*Stojim vam na raspolaganju[^\n]*[.!?,;]$/i,
    /\s*Javite (?:mi )?se (?:ako|slobodno)[^\n]*[.!?,;]$/i,
    /\s*Ako trebate (?:pomoć|još|išta)[^\n]*[.!?,;]$/i,
    /\s*Za (?:sve )?(?:dodatne|ostale) informacije[^\n]*[.!?,;]$/i,
    // EN
    /\s*If you need an(?:y|ything)\b[^\n]*[.!?,;]$/i,
    /\s*If there'?s? anything\b[^\n]*[.!?,;]$/i,
    /\s*Feel free to (?:contact|ask|reach|let)[^\n]*[.!?,;]$/i,
    /\s*Let me know if\b[^\n]*[.!?,;]$/i,
    /\s*I hope (?:that )?(?:this )?help\w*[^\n]*[.!?,;]$/i,
    /\s*Is there anything else\b[^\n]*[.!?,;]$/i,
    /\s*Don'?t hesitate\b[^\n]*[.!?,;]$/i,
    /\s*Happy to (?:help|assist)\b[^\n]*[.!?,;]$/i,
    /\s*Please (?:do not|don'?t) hesitate\b[^\n]*[.!?,;]$/i,
  ];

  let prev;
  do {
    prev = s;
    for (const re of SIGN_OFFS) {
      const stripped = s.replace(re, '').trim();
      if (stripped) s = stripped;  // only apply if result is non-empty
    }
  } while (s !== prev);

  // 3) Trailing-comma cleanup — remove any dangling comma (or comma+whitespace)
  // left at the end of the final sentence after sign-off stripping, e.g. "...čim,"
  s = s.replace(/[,;]\s*$/, '').trim();

  return s || answer.trim();
}

// Price hallucination guard
// -------------------------
function textContainsCurrency(s) {
  const t = String(s || '');
  return /€|\bEUR\b|\beur\b|\beuro\b|\bper night\b|\b\/night\b/i.test(t);
}

function contextContainsCurrency(hotelRec, records) {
  const parts = [];

  if (hotelRec) {
    parts.push(
      hotelRec.opis,
      hotelRec.parking,
      hotelRec.web
    );
  }

  for (const r of records || []) {
    parts.push(r.opis, r.aiPrompt, r.radnoVrijeme);
    if (r.type === 'ROOM') {
      parts.push(String(r.kvadratura ?? ''), String(r.kapacitet ?? ''), String(r.kat ?? ''), String(r.pogled ?? ''));
      parts.push((r.kreveti || []).join(' '), (r.roomAmenities || []).join(' '));
    } else {
      parts.push((r.kategorija || []).join(' '));
    }
  }

  const hay = parts.join('\n');
  return textContainsCurrency(hay);
}

function renderNoPriceInfo(lang) {
  return lang === 'EN'
    ? `The price is not available in the system. Please contact reception for a quote and availability.`
    : `Cijena nije dostupna u sustavu. Molim kontaktirajte recepciju za ponudu i dostupnost.`;
}

function applyPriceGuard(answer, { lang, hotelRec, recordsToUse }) {
  if (!answer) return answer;
  if (!textContainsCurrency(answer)) return answer;

  // ako u kontekstu nema valuta/cijena, a odgovor ih ima -> presijeci
  const ok = contextContainsCurrency(hotelRec, recordsToUse);
  if (!ok) return renderNoPriceInfo(lang);
  return answer;
}

// PWA WiFi renderer — reads the WiFi block from a ROOM GUIDE record.
// ROOM GUIDE.WiFi already contains the full formatted block (network + password).
// Returns null if room guide missing or WiFi field empty; caller falls back to SERVICES.
function renderWifiAnswerPwa(roomGuide) {
  if (!roomGuide?.wifi) return null;
  return roomGuide.wifi.trim();
}

// PWA AC renderer — reads Upute Klima from ROOM GUIDE.
// Returns null if room guide missing or field empty → GPT stub fallthrough.
function renderAcAnswer(roomGuide) {
  if (!roomGuide?.klimaUpute) return null;
  return roomGuide.klimaUpute.trim();
}

// PWA TV renderer — reads Upute TV from ROOM GUIDE.
// Returns null if room guide missing or field empty → GPT stub fallthrough.
function renderTvAnswer(roomGuide) {
  if (!roomGuide?.tvUpute) return null;
  return roomGuide.tvUpute.trim();
}

// PWA safe renderer — reads Upute Sef from ROOM GUIDE.
// Returns null if room guide missing or field empty → GPT fallthrough.
function renderSafeAnswer(roomGuide) {
  if (!roomGuide?.sefUpute) return null;
  return roomGuide.sefUpute.trim();
}

// Builds a structured room-context string from a ROOM GUIDE record for GPT injection.
// Fields included: name, features, WiFi, AC, TV, safe, notes, AI master prompt.
// AI Master prompt is appended last so hotel-specific overrides take precedence.
// Returns '' when roomGuide is null — callers should handle gracefully.
// ✅ PWA only: room number / identity answer
// Renders a concise answer from the room context already available in pwa-ask.
// No Airtable lookups needed — roomNumber comes from the validated request token.
function renderRoomNumberAnswer(roomNumber, roomGuide, lang = 'EN') {
  const tipSobe = roomGuide?.tipSobe || '';
  if (lang === 'HR') {
    return tipSobe
      ? `Nalazite se u sobi ${roomNumber} — ${tipSobe}.`
      : `Nalazite se u sobi ${roomNumber}.`;
  }
  return tipSobe
    ? `You are in Room ${roomNumber} — ${tipSobe}.`
    : `You are in Room ${roomNumber}.`;
}

// ✅ PWA only: extra towels / housekeeping request answer
// Directs guest to Reception or Help & Requests section without inventing a request.
function renderExtraTowelsAnswer(lang = 'EN') {
  if (lang === 'HR') {
    return 'Naravno. Molimo kontaktirajte recepciju ili pošaljite zahtjev putem odjeljka Zahtjevi u aplikaciji, i tim će vam urediti dodatne ručnike za sobu.';
  }
  return 'Of course. Please contact Reception or send a request through the Help & Requests section, and the team will arrange extra towels for your room.';
}

function buildRoomContext(roomGuide) {
  if (!roomGuide) return '';
  const parts = [];
  if (roomGuide.naziv)          parts.push(`Room: ${roomGuide.naziv}`);
  if (roomGuide.roomFeatures)   parts.push(`Room features: ${roomGuide.roomFeatures}`);
  if (roomGuide.wifi)           parts.push(`WiFi: ${roomGuide.wifi}`);
  if (roomGuide.klimaUpute)     parts.push(`AC instructions: ${roomGuide.klimaUpute}`);
  if (roomGuide.tvUpute)        parts.push(`TV instructions: ${roomGuide.tvUpute}`);
  if (roomGuide.sefUpute)       parts.push(`Safe instructions: ${roomGuide.sefUpute}`);
  if (roomGuide.napomene)       parts.push(`Room notes (internal — rephrase naturally for guest): ${roomGuide.napomene}`);
  if (roomGuide.aiMasterPrompt) parts.push(`\n# ROOM AI RULES\n${roomGuide.aiMasterPrompt}`);
  return parts.join('\n');
}

// -------------------------
// GPT answer generation — PWA (in-room concierge)
// Variant of generateAnswer() tailored for the guest PWA:
//  • System prompt identifies AI Olly as an in-room concierge (not web widget)
//  • Room context (buildRoomContext) is injected alongside hotel + services context
//  • AI Master Prompt from ROOM GUIDE is passed verbatim as overrideable rules
//  • Persona voice injected when available
// -------------------------
async function generateAnswerPwa({ question, hotelSlug, lang, hotelRec, intentPick, recordsToUse, roomGuide, outputRule }) {
  // Persona: use hotel-specific voice when configured in HOTELI.Persona Voice;
  // otherwise fall back to neutral AI Olly concierge — never hardcode a hotel-specific name.
  const personaSection = hotelRec?.personaVoice
    ? `PERSONA:\n${hotelRec.personaVoice}\nTone: warm, calm, precise. Apply persona only to factual and advisory answers. For emergencies, technical in-room instructions, and safe-handoff responses — neutral and precise, no persona.\nFor food: name at most 2 dishes total; name each dish once; do not list the same dish under different spellings; describe each dish in 3–5 words only.`
    : `PERSONA:\nYou are AI Olly, a professional digital concierge for this hotel.\nTone: warm, calm, precise. Apply persona only to factual and advisory answers. For emergencies, technical in-room instructions, and safe-handoff responses — neutral and precise, no persona.\nFor food: name at most 2 dishes total; name each dish once; describe each dish in 3–5 words only.`;

  const styleText = outputRule
    ? `OUTPUT RULE (Scope=${outputRule.scope}, Format=${outputRule.format}):
STYLE: ${outputRule.style}
EXAMPLE: ${outputRule.example}`
    : 'OUTPUT RULE: none (use clear short paragraphs).';

  const hotelBlock = hotelRec ? `# HOTEL CORE
Naziv: ${hotelRec.hotelNaziv || '-'}
Adresa: ${hotelRec.adresa || '-'}
Telefon recepcija: ${hotelRec.telefon || '-'}
Check-in: ${hotelRec.checkIn || '-'}
Check-out: ${hotelRec.checkOut || '-'}` : '# HOTEL CORE\n(no hotel record found)';

  const roomBlock = buildRoomContext(roomGuide) || '(no room context available)';

  const contextBlocks = (recordsToUse || []).map((r, idx) => {
    const aiPromptShort = (r.aiPrompt || '').slice(0, 700);
    const opisShort     = (r.opis     || '').slice(0, 1600);
    return `# SERVICE ${idx + 1}
Naziv: ${r.naziv || '-'}
Kategorija: ${(r.kategorija || []).join(', ') || '-'}
Radno vrijeme: ${r.radnoVrijeme || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
  });

  const sys = `You are "AI Olly" — an in-room digital concierge for hotel guests.

ABSOLUTE RULES (no exceptions):
- Never open an answer with a greeting ("Welcome", "Hello", "Good morning", "Dobrodošli", etc.) unless the guest's own message was itself a greeting.
- Never end an answer with a filler sign-off ("If you need anything, let me know", "Feel free to contact us", "I hope that helps", etc.). Stop after the last meaningful sentence.
- Never output a price unless it appears verbatim in the provided data.
- For real problems or emergencies, always direct the guest to call reception.
- LENGTH: Write exactly 1–2 sentences. Stop after your 2nd sentence. A 3rd sentence is only allowed if the guest explicitly asks a multi-part question.
- LANGUAGE: Plain, warm, precise prose. No metaphors, no dramatic imagery, no poetic weather phrasing. "Elegant clarity" means clear first, warm second.

TWO-TIER ANSWER POLICY:

TIER 1 — Hotel-specific facts (check-in/check-out times, breakfast, parking, room features, WiFi password, minibar, pet policy, prices, payment methods, hotel services, amenities, operational policies, in-room equipment):
- Answer ONLY from HOTEL CORE, ROOM CONTEXT, or SERVICE RECORDS provided.
- You CAN help with in-room topics (AC, TV, safe, WiFi) using the ROOM CONTEXT data.
- If the specific detail is NOT in the provided data, respond with EXACTLY this safe handoff:
  HR: "Nemam potvrđenu informaciju o tome, ali recepcija Vam rado može pomoći."
  EN: "I don't have confirmed information about that, but Reception will be happy to help."
- NEVER guess, infer, estimate, or improvise hotel-specific facts.

TIER 2 — General city and travel advice (local attractions, Split history, restaurant or cafe recommendations, beaches, rainy day activities, nightlife, safety, getting around, local food, day trips, cultural context):
- You MAY answer using general knowledge with careful wording ("generally", "typically", "visitors often enjoy", "a good starting point is").
- NEVER state specific opening hours, prices, exact distances, or partner/business names unless they appear in the provided data.
- Where appropriate, mention that Reception or the City Map and Routes sections in the guide app can offer more tailored suggestions.

${personaSection}

${styleText}

OUTPUT FORMAT:
- Write in flowing prose. Do NOT use bullet points (•, -, *) or numbered lists unless the guest explicitly asks "list" or "what are all".
- If room notes contain raw shorthand, internal abbreviations, or non-English phrases, rephrase them clearly in the answer language — do not copy them verbatim.
- For room feature questions, describe the room naturally, not as a feature inventory.

Language:
- If lang=HR respond in Croatian.
- If lang=EN respond in English.

Data usage:
- Keep hotel names, service names, and brand names exactly as provided. Rephrase raw internal notes naturally.`;

  const userPayload = {
    lang,
    hotel_slug:      hotelSlug,
    question,
    picked_intent:   intentPick?.intent  || null,
    confidence:      intentPick?.confidence ?? null,
    hotel_core:      hotelBlock,
    room_context:    roomBlock,
    service_records: contextBlocks,
  };

  try {
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: sys },
        { role: 'user',   content: JSON.stringify(userPayload) },
      ],
    });
    return resp.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    if (isOpenAIRateLimitError(e)) {
      const err = new Error('OPENAI_RATE_LIMIT');
      err._isRate = true;
      throw err;
    }
    throw e;
  }
}

// -------------------------
// GPT answer generation (STRICT)
// -------------------------
async function generateAnswer({ question, hotelSlug, lang, hotelRec, intentPick, recordsToUse, outputRule }) {
  // Persona: use hotel-specific voice when configured in HOTELI.Persona Voice;
  // otherwise fall back to neutral AI Olly concierge — never hardcode a hotel-specific name.
  const personaSection = hotelRec?.personaVoice
    ? `PERSONA:\n${hotelRec.personaVoice}\nTone: warm, calm, precise. Apply persona only to factual and advisory answers. For emergencies and safe-handoff responses — neutral and precise, no persona.\nFor food: name at most 2 dishes total; name each dish once; do not list the same dish under different spellings; describe each dish in 3–5 words only.`
    : `PERSONA:\nYou are AI Olly, a professional digital concierge for this hotel.\nTone: warm, calm, precise. Apply persona only to factual answers; for emergencies and safe-handoff responses — neutral and precise, no persona.\nFor food: name at most 2 dishes total; name each dish once; describe each dish in 3–5 words only.`;

  const styleText = outputRule
    ? `OUTPUT RULE (Scope=${outputRule.scope}, Format=${outputRule.format}):
STYLE: ${outputRule.style}
EXAMPLE: ${outputRule.example}`
    : 'OUTPUT RULE: none (use clear short paragraphs).';

  const hotelBlock = hotelRec ? `# HOTEL CORE
Naziv: ${hotelRec.hotelNaziv || '-'}
Slug: ${hotelRec.slug || hotelSlug}
Opis: ${hotelRec.opis || '-'}
Adresa: ${hotelRec.adresa || '-'}
Telefon: ${hotelRec.telefon || '-'}
Email: ${hotelRec.email || '-'}
Web: ${hotelRec.web || '-'}
Check-in: ${hotelRec.checkIn || '-'}
Check-out: ${hotelRec.checkOut || '-'}
Google Maps: ${hotelRec.googleMaps || '-'}
Google Review: ${hotelRec.googleReview || '-'}
Instagram: ${hotelRec.instagram || '-'}
Parking: ${hotelRec.parking || '-'}` : '# HOTEL CORE\n(no hotel record found)';

  const contextBlocks = recordsToUse.map((r, idx) => {
    const aiPromptShort = (r.aiPrompt || '').slice(0, 700);
    const opisShort = (r.opis || '').slice(0, 1600);

    if (r.type === 'ROOM') {
      return `# RECORD ${idx + 1} (ROOM)
Naziv: ${r.naziv || '-'}
Tip sobe: ${r.tipSobe || '-'}
Slug: ${r.slug || '-'}
Kapacitet (osoba): ${r.kapacitet ?? '-'}
Kvadratura: ${r.kvadratura ?? '-'}
Kat: ${r.kat ?? '-'}
Pogled: ${r.pogled ?? '-'}
Kreveti: ${(r.kreveti || []).join(', ') || '-'}
Room Amenities: ${(r.roomAmenities || []).join(', ') || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
    }

    return `# RECORD ${idx + 1} (SERVICE)
Naziv: ${r.naziv || '-'}
Kategorija: ${(r.kategorija || []).join(', ') || '-'}
Radno vrijeme: ${r.radnoVrijeme || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
  });

  const sys = `You are "AI Olly" — a hotel web assistant for website visitors.

ABSOLUTE RULES (no exceptions):
- Do NOT repeat greetings unless the user greets first.
- LENGTH: Write exactly 1–2 sentences. Stop after your 2nd sentence. A 3rd is only allowed if the user explicitly asks a multi-part question.
- LANGUAGE: Plain, warm, precise prose. No metaphors, no dramatic imagery, no poetic weather phrasing.
- If user asks to LIST things (amenities, beds, views, room types), you MUST output a clean bullet list. Do NOT describe in prose.
- If multiple items match (e.g., multiple rooms with a view), list ALL relevant items you have in RECORDS.
- Never output a price unless it exists verbatim in HOTEL CORE or RECORDS.
- This is WEB (website visitor). Do NOT handle in-room complaints or troubleshooting flows; if user reports an in-room issue, direct them to reception.

TWO-TIER ANSWER POLICY:

TIER 1 — Hotel-specific facts (check-in/check-out times, breakfast, parking, room types, amenities, WiFi, pet policy, prices, payment methods, hotel services, policies, addresses, phone numbers):
- Answer ONLY from HOTEL CORE or RECORDS provided.
- If the specific detail is NOT in the provided data, respond with EXACTLY this safe handoff:
  HR: "Nemam potvrđenu informaciju o tome, ali recepcija Vam rado može pomoći."
  EN: "I don't have confirmed information about that, but Reception will be happy to help."
- NEVER guess, infer, estimate, or improvise hotel-specific facts.

TIER 2 — General city and travel advice (local attractions, Split history, restaurant or cafe recommendations, beaches, rainy day activities, nightlife, safety, getting around, local food, day trips, cultural context):
- You MAY answer using general knowledge with careful wording ("generally", "typically", "visitors often enjoy", "a good starting point is").
- NEVER state specific opening hours, prices, exact distances, or partner/business names unless they appear in the provided data.
- Where appropriate, mention that Reception can offer more tailored suggestions.

${personaSection}

${styleText}

Language:
- If lang=HR respond in Croatian.
- If lang=EN respond in English.

Data usage:
- Keep proper nouns/labels exactly as provided in RECORDS (do not invent or translate them).`;

  const userPayload = {
    lang,
    hotel_slug: hotelSlug,
    question,
    picked_intent: intentPick?.intent || null,
    confidence: intentPick?.confidence ?? null,
    hotel_core: hotelBlock,
    records: contextBlocks,
  };

  try {
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });

    return resp.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    if (isOpenAIRateLimitError(e)) {
      const err = new Error('OPENAI_RATE_LIMIT');
      err._isRate = true;
      throw err;
    }
    throw e;
  }
}

// -------------------------
// Routes
// -------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ai-olly-hub-web', time: nowIso(), build: BUILD });
});

// Debug: vidi koliko recorda server vidi za hotel
app.get('/api/debug', async (req, res) => {
  try {
    const hotelSlug = pickFirstNonEmpty(req.query?.slug, HOTEL_SLUG_DEFAULT);
    const { hotelRec, services, rooms, all } = await fetchKnowledgeRows({ hotelSlug, intent: null, question: '' });

    res.json({
      ok: true,
      time: nowIso(),
      build: BUILD,
      hotelSlug,
      counts: {
        hotelRecordFound: Boolean(hotelRec),
        servicesForHotelWeb: services.length,
        roomsForHotelWeb: rooms.length,
        totalWebRecordsForHotel: all.length,
      },
      sampleKeys: {
        hotel_keys: hotelRec ? Object.keys(hotelRec) : [],
        services_first: services[0] ? Object.keys(services[0]) : [],
        rooms_first: rooms[0] ? Object.keys(rooms[0]) : [],
      }
    });
  } catch (e) {
    console.error('debug error:', e);
    res.status(500).json({ ok: false, error: 'Debug error' });
  }
});

// ── AI Response Logging helpers ───────────────────────────────────────────────
//
// isSafeHandoffAnswer  — detects safe-handoff / no-info answers
// classifyConfidence   — HIGH / MEDIUM / LOW from response path
// classifyUnansweredReason — keyword for why the answer was a handoff
// _writeResponseLog    — fire-and-forget: write one AI_RESPONSE_LOGS record
// _writeUnansweredLog  — fire-and-forget: write one UNANSWERED_QUESTIONS record
//
// Safety: never awaited on the critical path; errors surface as console.error only.
// Privacy: question/answer capped at 2 000/3 000 chars; tokens and secrets never logged.
// ─────────────────────────────────────────────────────────────────────────────

function isSafeHandoffAnswer(answer) {
  if (!answer) return false;
  const a = answer.toLowerCase();
  return (
    a.includes("don't have that information in the system")  ||
    a.includes("don't have confirmed information about that") ||
    a.includes("please contact reception for exact details")  ||
    a.includes("please contact reception for a quote")        ||
    a.includes("price is not available in the system")        ||
    a.includes("nemam taj podatak u sustavu")                  ||
    a.includes("kontaktirajte recepciju za točne informacije")
  );
}

function classifyConfidence(payload) {
  const meta   = payload?.meta  || {};
  const answer = payload?.answer || '';

  if (meta.rate_limited || meta.openai_rate_limited) return 'LOW';
  if (!answer) return 'LOW';
  if (isSafeHandoffAnswer(answer)) return 'LOW';

  // Named deterministic handler = HIGH
  const det = meta.deterministic;
  if (det && det !== false && typeof det === 'string') return 'HIGH';

  // web-ask: intent-linked records used = HIGH
  if (meta.usedLinked === true) return 'HIGH';

  // Both endpoints: intent matched AND records provided = HIGH
  if (meta.intent && Array.isArray(meta.usedRecords) && meta.usedRecords.length > 0) return 'HIGH';

  // Records available but no strong intent match = MEDIUM
  if (Array.isArray(meta.usedRecords) && meta.usedRecords.length > 0) return 'MEDIUM';
  if (meta.usedFallback) return 'MEDIUM';

  return 'LOW';
}

function classifyUnansweredReason(question) {
  const q = (question || '').toLowerCase();
  if (/\bpric(e|ing)\b|how much|\bcost\b|\brate\b|\bfee\b/.test(q)) return 'missing_price';
  if (/\bpay(ment)?\b|\bcard\b|\bcash\b|\binvoice\b/.test(q))       return 'missing_payment_policy';
  if (/\bcctv\b|\bcamera\b|\bsurveillance\b/.test(q))               return 'missing_security_policy';
  if (/\bpark(ing)?\b/.test(q))                                      return 'missing_hotel_fact';
  return 'missing_hotel_fact';
}

function classifyUnansweredPriority(reason) {
  if (reason === 'missing_price' || reason === 'missing_payment_policy') return 'High';
  return 'Medium';
}

async function _writeUnansweredLog(ctx, meta, answer) {
  const reason = classifyUnansweredReason(ctx.question);
  await base(TABLE_UNANSWERED).create({
    'Question':        String(ctx.question || '').slice(0, 2000),
    'Timestamp':       new Date().toISOString(),
    'Hotel Slug':      String(ctx.slug     || ''),
    'Endpoint':        String(ctx.endpoint || ''),
    'Room':            String(ctx.room     || ''),
    'Detected Intent': String(meta.intent  || ''),
    'Answer Given':    String(answer       || '').slice(0, 3000),
    'Language':        String(ctx.lang     || ''),
    'Reason':          reason,
    'Status':          'New',
    'Priority':        classifyUnansweredPriority(reason),
  });
}

async function _writeResponseLog(payload, ctx, started) {
  const ms     = Date.now() - started;
  const meta   = payload.meta  || {};
  const answer = payload.answer || '';

  const det    = meta.deterministic;
  const isDet  = det && det !== false && typeof det === 'string';
  const safeHO = isSafeHandoffAnswer(answer);
  const confidence = classifyConfidence(payload);

  const srcRecs = Array.isArray(meta.usedRecords)
    ? meta.usedRecords.map(r => r.id || r.naziv).filter(Boolean).join(', ')
    : '';
  const srcType = isDet              ? 'deterministic'
                : srcRecs            ? 'airtable'
                : meta.usedFallback  ? 'fallback'
                : 'unknown';

  await base(TABLE_RESPONSE_LOGS).create({
    'Question':       String(ctx.question || '').slice(0, 2000),
    'Timestamp':      new Date().toISOString(),
    'Hotel Slug':     String(ctx.slug     || ''),
    'Endpoint':       String(ctx.endpoint || ''),
    'Room':           String(ctx.room     || ''),
    'Answer':         String(answer       || '').slice(0, 3000),
    'Language':       String(ctx.lang     || ''),
    'Intent':         String(meta.intent  || ''),
    'Deterministic':  isDet ? String(det) : '',
    'Source Type':    srcType,
    'Source Records': srcRecs,
    'Confidence':     confidence,
    'Latency ms':     ms,
    'Safe Handoff':   safeHO,
    'Build Hash':     BUILD,
  });

  if (safeHO) {
    await _writeUnansweredLog(ctx, meta, answer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/web-ask', async (req, res) => {
  const started = Date.now();

  try {
    const question = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const hotelSlug = pickFirstNonEmpty(req.query?.slug, req.body?.slug, HOTEL_SLUG_DEFAULT);
    const lang = detectLang(question);

    // ── Logging intercept ─────────────────────────────────────────────────────
    // Captures every successful res.json() call for AI_RESPONSE_LOGS.
    // res.status(N).json() is NOT intercepted (400/403/500 are not logged).
    const _wLogCtx   = { endpoint: 'web-ask', slug: hotelSlug, room: '', lang, question: question || '' };
    const _wOrigJson = res.json.bind(res);
    res.json = (payload) => {
      if (payload?.ok && payload?.answer) {
        _writeResponseLog(payload, _wLogCtx, started)
          .catch(e => console.error('[log] web-ask:', e?.message));
      }
      return _wOrigJson(payload);
    };
    // ─────────────────────────────────────────────────────────────────────────

    if (!question) return res.status(400).json({ ok: false, error: 'Missing question' });

    // 7) STABILNOST: local rate limit -> "pričekaj 20s"
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (shouldRateLimit(ip)) {
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer: renderWait20s(lang),
        meta: { hotelSlug, ms, rate_limited: true }
      });
    }

    // 1) patterns + intent
    const patterns = await getIntentPatternsForWeb();
    const intentPick = await chooseIntent(question, patterns);

    // 2) load knowledge (cached filtered lists)
    const { hotelRec, services, rooms, matched, fallback, all } = await fetchKnowledgeRows({
      hotelSlug,
      intent: intentPick.intent,
      question,
    });

    // ✅ 0) Deterministički: check-in/out TIME only — concise, no social links
    // Must fire BEFORE isContactCoreQuestion to avoid full hotel card for simple timing questions.
    if (isCheckinTimeOnlyQuestion(question)) {
      const answer = renderCheckinTimeAnswer(hotelRec, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          deterministic: 'checkin_time',
          ms,
        },
      });
    }

    // ✅ 0.05) Deterministički: maintenance report — broken device
    // Must fire BEFORE isContactCoreQuestion — "who do I call?" contains 'call' which
    // bleeds into hotel_core.
    if (isMaintenanceReportQuestion(question)) {
      const phone = hotelRec?.telefon;
      const answer = lang === 'EN'
        ? `Please contact Reception immediately${phone ? ` at ${phone}` : ''}. Our team is available 24/7 and will arrange the right solution for you.`
        : `Molimo odmah kontaktirajte recepciju${phone ? ` na broju ${phone}` : ''}. Tim je dostupan 24/7 i riješit će problem za vas.`;
      const ms = Date.now() - started;
      return res.json({ ok: true, answer, meta: { hotelSlug, deterministic: 'maintenance_report', ms } });
    }

    // ✅ 0.08) Deterministički: WhatsApp — must fire BEFORE isContactCoreQuestion
    // "How to contact you on WhatsApp?" contains 'contact' → isContactCoreQuestion
    // would intercept it and return the phone number instead of the WA link.
    if (isWhatsAppQuestion(question)) {
      const answer = renderWhatsAppAnswer(hotelRec, services, lang);
      const ms = Date.now() - started;
      return res.json({ ok: true, answer, meta: { hotelSlug, deterministic: 'whatsapp', ms } });
    }

    // ✅ 0.1) Deterministički: HOTEL core (kontakt / maps / check-in-out)
    if (isContactCoreQuestion(question)) {
      const answer = renderFocusedHotelCoreAnswer(hotelRec, question, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          deterministic: 'hotel_core',
          ms,
        },
      });
    }

    // ✅ 0.5) Deterministički: radno vrijeme doručka (Fix #7)
    if (isBreakfastHoursQuestion(question)) {
      const answer = renderBreakfastHoursAnswer(services, lang);
      if (answer) {
        const ms = Date.now() - started;
        return res.json({
          ok: true,
          answer,
          meta: {
            hotelSlug,
            deterministic: 'breakfast_hours',
            ms,
          },
        });
      }
      // answer is null (no breakfast record or missing radnoVrijeme) — fall through to GPT
    }

    // ✅ 0.6) Deterministički: radno vrijeme domaćinstva (Fix #8)
    if (isHousekeepingHoursQuestion(question)) {
      const answer = renderHousekeepingHoursAnswer(services, lang);
      if (answer) {
        const ms = Date.now() - started;
        return res.json({
          ok: true,
          answer,
          meta: {
            hotelSlug,
            deterministic: 'housekeeping_hours',
            ms,
          },
        });
      }
      // answer is null (no housekeeping record or missing radnoVrijeme) — fall through to GPT
    }

    // ✅ 0.7) Deterministički: WiFi pristup i lozinka (Fix #9)
    if (isWifiQuestion(question)) {
      const answer = renderWifiAnswer(services);
      if (answer) {
        const ms = Date.now() - started;
        return res.json({
          ok: true,
          answer,
          meta: {
            hotelSlug,
            deterministic: 'wifi',
            ms,
          },
        });
      }
      // answer is null (no WiFi record found) — fall through to GPT
    }

    // ✅ 0.8) Deterministički: politika kućnih ljubimaca (Fix #10)
    if (isPetPolicyQuestion(question)) {
      const answer = renderPetPolicyAnswer(services);
      if (answer) {
        const ms = Date.now() - started;
        return res.json({
          ok: true,
          answer,
          meta: {
            hotelSlug,
            deterministic: 'pet_policy',
            ms,
          },
        });
      }
      // answer is null (no pet policy record found) — fall through to GPT
    }

    // 4) Deterministički: “vrste soba”
    if (isRoomTypesQuestion(question)) {
      const answer = renderRoomTypesAnswer(rooms, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          intent: intentPick.intent,
          confidence: intentPick.confidence ?? null,
          scopeWanted: 'General',
          usedRecords: rooms.slice(0, 20).map(r => ({ type: r.type, naziv: r.naziv, id: r.id })),
          usedFallback: false,
          usedLinked: false,
          deterministic: 'room_types',
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // ✅ Deterministički: “Which rooms have UNESCO/Palace view?”
    if (isRoomViewListQuestion(question)) {
      const answer = renderRoomsByViewAnswer(rooms, question, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          deterministic: 'rooms_by_view',
          usedRecords: rooms.slice(0, 20).map(r => ({ type: 'ROOM', naziv: r.naziv, id: r.id })),
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // 4) Deterministički: amenities (general ili za određenu sobu)
    if (isRoomAmenitiesQuestion(question)) {
      const room = findBestRoomMention(question, rooms);
      const answer = room
        ? renderRoomAmenitiesForRoom(room, lang)
        : renderRoomAmenitiesGeneral(rooms, lang);

      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          intent: intentPick.intent,
          confidence: intentPick.confidence ?? null,
          scopeWanted: 'General',
          usedRecords: room ? [{ type: 'ROOM', naziv: room.naziv, id: room.id }] : rooms.slice(0, 10).map(r => ({ type: 'ROOM', naziv: r.naziv, id: r.id })),
          usedFallback: false,
          usedLinked: false,
          deterministic: 'room_amenities',
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // 4) Deterministički: bed types / twin vs king  ✅ FIX: više nema substring provjere "king"
    if (isBedTypeQuestion(question)) {
      const answer = renderBedTypesAnswer(rooms, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          intent: intentPick.intent,
          confidence: intentPick.confidence ?? null,
          scopeWanted: 'General',
          usedRecords: rooms.slice(0, 20).map(r => ({ type: r.type, naziv: r.naziv, id: r.id })),
          usedFallback: false,
          usedLinked: false,
          deterministic: 'bed_types',
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // 5) Room difference handler (robustnije: pokušaj izdvojiti 2 segmenta)
    if (isRoomDifferenceQuestion(question)) {
      const [partA, partB] = splitIntoTwoRoomQueries(question);

      const roomA = findBestRoomMention(partA, rooms);
      const roomB = findBestRoomMention(partB, rooms);

      // fallback: ako ne nađe iz segmenata, uzmi top2 po score
      let finalA = roomA;
      let finalB = roomB;

      if (!finalA || !finalB) {
        const qn = normalizeText(question);
        const scored = (rooms || []).map(r => ({ r, s: roomMatchScore(qn, r) })).sort((a, b) => b.s - a.s);
        if (!finalA && scored[0]?.s >= 3) finalA = scored[0].r;
        if (!finalB && scored[1]?.s >= 3) finalB = scored[1].r;
      }

      const answer = renderRoomDifference(finalA, finalB, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          intent: intentPick.intent,
          confidence: intentPick.confidence ?? null,
          scopeWanted: 'General',
          usedRecords: [finalA, finalB].filter(Boolean).map(r => ({ type: 'ROOM', naziv: r.naziv, id: r.id })),
          usedFallback: false,
          usedLinked: false,
          deterministic: 'room_difference',
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // 6) Ako intent postoji i pattern ima linked recorde -> koristi njih (PRIMARNO)
    let recordsToUse = [];
    let usedLinked = false;

    if (intentPick.intent) {
      const p = patterns.find(x => String(x.intent) === String(intentPick.intent));
      const svcIds = asArray(p?.servicesLink);
      const roomIds = asArray(p?.roomsLink);

      // ✅ učitaj linked recorde direktno po ID-ju (ne ovisi o filteru po slug-u)
      const [svcRecs, roomRecs] = await Promise.all([
        airtableFindByIds(TABLE_SERVICES, svcIds, 30),
        airtableFindByIds(TABLE_ROOMS, roomIds, 30),
      ]);

      const linkedServices = svcRecs.map(mapServiceRecord).filter(r =>
        r.active &&
        allowForWeb(r.aiSource) &&
        matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
      );

      const linkedRooms = roomRecs.map(mapRoomRecord).filter(r =>
        r.active &&
        allowForWeb(r.aiSource) &&
        matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
      );

      const linked = [...linkedServices, ...linkedRooms];

      if (linked.length) {
        recordsToUse = linked;
        usedLinked = true;
      }
    }

    // 3) fallback na AI_INTENT tagging ako nema linked
    if (!recordsToUse.length) {
      recordsToUse = matched.length ? matched : fallback;
    }

    // 6) dodatni micro-fallback: ako i dalje prazno, probaj scoring iz ALL
    if (!recordsToUse.length) {
      const extra = pickFallbackRecords(question, all, 3);
      if (extra.length) recordsToUse = extra;
    }

    // 6) HARD STOP: hotel-specific bez podataka -> nema GPT-a (osim city pitanja)
    if (isHotelSpecificQuestion(question) && !recordsToUse.length && !isCityQuestion(question)) {
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer: renderNoInfo(lang),
        meta: {
          hotelSlug,
          intent: intentPick.intent,
          confidence: intentPick.confidence ?? null,
          scopeWanted: 'General',
          usedRecords: [],
          usedFallback: false,
          usedLinked,
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // output scope + output rule
    let scopeWanted = 'General';
    if (intentPick?.intent) {
      const p = patterns.find(x => String(x.intent) === String(intentPick.intent));
      scopeWanted = (p?.outputScope || intentPick.outputScope || 'General');
    }

    let outputRule = await getOutputRule({ scopeWanted, aiSourceWanted: 'WEB' });
    if (!outputRule && String(scopeWanted).toLowerCase() !== 'general') {
      outputRule = await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'WEB' });
    }

    // 2) Generate answer (strict)
    let answer = '';
    try {
      answer = await generateAnswer({
        question,
        hotelSlug,
        lang,
        hotelRec,
        intentPick,
        recordsToUse,
        outputRule,
      });
    } catch (e) {
      if (e?._isRate || String(e?.message || '') === 'OPENAI_RATE_LIMIT' || isOpenAIRateLimitError(e)) {
        const ms = Date.now() - started;
        return res.json({
          ok: true,
          answer: renderWait20s(lang),
          meta: { hotelSlug, ms, openai_rate_limited: true }
        });
      }
      throw e;
    }

    // ✅ anti-hallucination guard za cijene
    answer = applyPriceGuard(answer, { lang, hotelRec, recordsToUse });

    const ms = Date.now() - started;

    res.json({
      ok: true,
      answer,
      meta: {
        hotelSlug,
        intent: intentPick.intent,
        confidence: intentPick.confidence ?? null,
        scopeWanted,
        usedRecords: recordsToUse.map(r => ({ type: r.type, naziv: r.naziv, id: r.id })),
        usedFallback: (!matched.length && fallback.length) ? true : false,
        usedLinked,
        totalWebRecordsForHotel: all.length,
        ms,
      },
    });
  } catch (e) {
    console.error('web-ask error:', e);

    // 7) ako je OpenAI “zakucao” zbog rate limit / overload -> poruka 20s
    const question = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const lang = detectLang(question);
    if (isOpenAIRateLimitError(e)) {
      return res.json({ ok: true, answer: renderWait20s(lang), meta: { openai_rate_limited: true } });
    }

    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-ask — guest-side PWA endpoint
//
// Input:  { question, slug, room, token }
// Sources: HOTELI + SERVICES(PWA) + ROOM GUIDE(room-specific)
// Auth:   QR token validated against ROOM GUIDE.Access Token (timing-safe)
// Flow:   deterministic chain → intent routing (PWA patterns) → generateAnswerPwa()
// -------------------------
app.post('/api/pwa-ask', async (req, res) => {
  const started = Date.now();

  try {
    const question   = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const hotelSlug  = pickFirstNonEmpty(req.query?.slug, req.body?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room, req.query?.room, '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');
    const lang       = detectLang(question);

    // ── Logging intercept ─────────────────────────────────────────────────────
    // Captures every successful res.json() call for AI_RESPONSE_LOGS.
    // res.status(N).json() is NOT intercepted (400/403/500 are not logged).
    const _pLogCtx   = { endpoint: 'pwa-ask', slug: hotelSlug, room: roomNumber, lang, question: question || '' };
    const _pOrigJson = res.json.bind(res);
    res.json = (payload) => {
      if (payload?.ok && payload?.answer) {
        _writeResponseLog(payload, _pLogCtx, started)
          .catch(e => console.error('[log] pwa-ask:', e?.message));
      }
      return _pOrigJson(payload);
    };
    // ─────────────────────────────────────────────────────────────────────────

    if (!question)   return res.status(400).json({ ok: false, error: 'Missing question' });
    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room number' });

    // Rate limiting — reuse same gate as web-ask
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    if (shouldRateLimit(ip)) {
      return res.json({
        ok: true,
        answer: renderWait20s(lang),
        meta: { hotelSlug, roomNumber, ms: Date.now() - started, rate_limited: true },
      });
    }

    // Load all PWA data sources in parallel
    const [hotelRec, pwaServices, roomGuide] = await Promise.all([
      getHotelRecord(hotelSlug),
      getServicesForHotelPwa(hotelSlug),
      getRoomGuideRecord(hotelSlug, roomNumber),
    ]);

    // ── Token validation ────────────────────────────────────────────────────────
    // roomGuide null → room not found → 403 (same response, don't reveal room existence)
    // token missing or mismatch → 403
    // timing-safe comparison prevents length-based timing attacks.
    // When Access Token field is not yet created in Airtable, accessToken will be ''
    // and validation will always fail — intentional fail-closed behaviour.
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid = (
      token.length > 0 &&
      storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) {
      console.warn(`[pwa-ask] 403: slug=${hotelSlug} room=${roomNumber} token_len=${token.length} stored_len=${storedToken.length} room_found=${roomGuide !== null}`);
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }
    // ───────────────────────────────────────────────────────────────────────────

    // ✅ -2) Deterministic: emergency / medical / fire — fires first, before all other handlers
    // Returns reception phone number + emergency numbers (112 / 194) immediately.
    // Must fire before isContactCoreQuestion to prevent hotel-card dump on medical queries
    // such as "I need a doctor, who should I call?" or "There is an emergency in my room."
    if (isEmergencyQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderEmergencyAnswer(hotelRec, lang, question),
        meta: { hotelSlug, roomNumber, deterministic: 'emergency', ms: Date.now() - started },
      });
    }

    // ✅ -1) Deterministic: concise check-in/out time only (fires before hotel_core card)
    // "What time is check-in?" → concise timing answer, not the full hotel card.
    if (isCheckinTimeOnlyQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderCheckinTimeAnswer(hotelRec, lang),
        meta: { hotelSlug, roomNumber, deterministic: 'checkin_time', ms: Date.now() - started },
      });
    }

    // ✅ -0.5) Deterministic (PWA only): room number / room identity
    // Guest asks "what is my room?" / "which room am I in?" — answer directly
    // from the already-validated room context. No Airtable lookup needed.
    // Guard: only fires if roomNumber is present (it always is post-auth, but be safe).
    if (isRoomNumberQuestion(question)) {
      if (roomNumber) {
        return res.json({
          ok: true,
          answer: renderRoomNumberAnswer(roomNumber, roomGuide, lang),
          meta: { hotelSlug, roomNumber, deterministic: 'room_number', ms: Date.now() - started },
        });
      }
      // roomNumber missing — fall through to safe handoff via GPT
    }

    // ✅ 0) Deterministic (PWA only): maintenance report — broken device in room
    // "The AC is not working", "shower is broken", "light not working" etc.
    // Must fire BEFORE isContactCoreQuestion — "who do I call?" contains 'call' which
    // would otherwise bleed into hotel_core and return the hotel card instead.
    if (isMaintenanceReportQuestion(question)) {
      const phone = hotelRec?.telefon;
      const answer = lang === 'EN'
        ? `Please contact Reception immediately${phone ? ` at ${phone}` : ''}. Our team is available 24/7 and will arrange the right solution for you.`
        : `Molimo odmah kontaktirajte recepciju${phone ? ` na broju ${phone}` : ''}. Tim je dostupan 24/7 i riješit će problem za vas.`;
      return res.json({
        ok: true,
        answer,
        meta: { hotelSlug, roomNumber, deterministic: 'maintenance_report', ms: Date.now() - started },
      });
    }

    // ✅ 0.08) Deterministic: WhatsApp — must fire BEFORE isContactCoreQuestion
    // "How to contact you on WhatsApp?" contains 'contact' → isContactCoreQuestion
    // would intercept it and return the phone number instead of the WA link.
    if (isWhatsAppQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderWhatsAppAnswer(hotelRec, pwaServices, lang),
        meta: { hotelSlug, roomNumber, deterministic: 'whatsapp', ms: Date.now() - started },
      });
    }

    // ✅ 0.1) Deterministic: hotel core (contact / address / check-in-out)
    if (isContactCoreQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderFocusedHotelCoreAnswer(hotelRec, question, lang),
        meta: { hotelSlug, roomNumber, deterministic: 'hotel_core', ms: Date.now() - started },
      });
    }

    // ✅ 0.5) Deterministic: breakfast hours
    if (isBreakfastHoursQuestion(question)) {
      const answer = renderBreakfastHoursAnswer(pwaServices, lang);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'breakfast_hours', ms: Date.now() - started },
        });
      }
    }

    // ✅ 0.6) Deterministic: housekeeping hours
    if (isHousekeepingHoursQuestion(question)) {
      const answer = renderHousekeepingHoursAnswer(pwaServices, lang);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'housekeeping_hours', ms: Date.now() - started },
        });
      }
    }

    // ✅ 0.65) Deterministic (PWA only): extra towels / housekeeping request
    // Guest asks for extra towels — direct operational answer, no GPT needed.
    // Does NOT auto-create a request; directs to Reception or Help & Requests.
    if (isExtraTowelsQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderExtraTowelsAnswer(lang),
        meta: { hotelSlug, roomNumber, deterministic: 'extra_towels', ms: Date.now() - started },
      });
    }

    // ✅ 0.7) Deterministic: WiFi — ROOM GUIDE takes priority over SERVICES in PWA
    // ROOM GUIDE.WiFi is room-specific and already formatted (network + password).
    if (isWifiQuestion(question)) {
      const answer = renderWifiAnswerPwa(roomGuide) ?? renderWifiAnswer(pwaServices);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: {
            hotelSlug,
            roomNumber,
            deterministic: 'wifi',
            wifiSource: roomGuide?.wifi ? 'room_guide' : 'services',
            ms: Date.now() - started,
          },
        });
      }
    }

    // ✅ 0.8) Deterministic: pet policy
    if (isPetPolicyQuestion(question)) {
      const answer = renderPetPolicyAnswer(pwaServices);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'pet_policy', ms: Date.now() - started },
        });
      }
    }

    // ✅ 1.0) Deterministic (PWA only): AC / climate control
    if (isAcQuestion(question)) {
      const answer = renderAcAnswer(roomGuide);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'ac_instructions', ms: Date.now() - started },
        });
      }
    }

    // ✅ 1.1) Deterministic (PWA only): TV / remote control
    if (isTvQuestion(question)) {
      const answer = renderTvAnswer(roomGuide);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'tv_instructions', ms: Date.now() - started },
        });
      }
    }

    // ✅ 1.2) Deterministic (PWA only): safe / valuables
    if (isSafeQuestion(question)) {
      const answer = renderSafeAnswer(roomGuide);
      if (answer) {
        return res.json({
          ok: true,
          answer,
          meta: { hotelSlug, roomNumber, deterministic: 'safe_instructions', ms: Date.now() - started },
        });
      }
    }

    // ✅ 1.3) Deterministic (PWA only): city / sightseeing / excursion questions
    // No attraction data exists in SERVICES — point guest to City Map + Routes in the app.
    if (isCityActivityQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderCityActivityHint(lang),
        meta: { hotelSlug, roomNumber, deterministic: 'city_activity', ms: Date.now() - started },
      });
    }

    // ── GPT path ──────────────────────────────────────────────────────────────
    // Intent routing (PWA patterns) → linked/fallback service records →
    // generateAnswerPwa() with room context + hotel context + persona voice.
    // Rate limit → renderWait20s(). Empty answer → renderNoInfo(). Price guard applied.
    // ─────────────────────────────────────────────────────────────────────────
    const patterns  = await getIntentPatternsForPwa();

    // ✅ 1.4) Pre-GPT parking guard — force parking_availability_query
    // GPT tends to misclassify "Is there parking near…" / "Do you have parking near…"
    // as the 'drop off' intent.  When isParkingAvailabilityQuery fires we skip
    // chooseIntent() entirely and wire the correct pattern directly.
    if (isParkingAvailabilityQuery(question)) {
      const parkPat  = patterns.find(x => String(x.intent) === 'parking_availability_query');
      const parkIds  = asArray(parkPat?.servicesLink);
      if (parkIds.length) {
        const parkRecs = await airtableFindByIds(TABLE_SERVICES, parkIds, 30);
        const linked   = parkRecs.map(mapServiceRecord).filter(r =>
          r.active && allowForPWA(r.aiSource) && matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
        );
        if (linked.length) {
          const forcedIntent = { intent: 'parking_availability_query', confidence: 1, outputScope: 'General' };
          const outputRule   =
            await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'PWA' });
          let answer = '';
          try {
            answer = await generateAnswerPwa({
              question, hotelSlug, lang, hotelRec, intentPick: forcedIntent,
              recordsToUse: linked, roomGuide, outputRule,
            });
          } catch (e) {
            if (e?._isRate || isOpenAIRateLimitError(e)) {
              return res.json({ ok: true, answer: renderWait20s(lang),
                meta: { hotelSlug, roomNumber, ms: Date.now() - started, openai_rate_limited: true } });
            }
            throw e;
          }
          if (!answer) answer = renderNoInfo(lang);
          answer = stripChatWrap(answer);
          answer = applyPriceGuard(answer, { lang, hotelRec, recordsToUse: linked });
          return res.json({
            ok: true, answer,
            meta: { hotelSlug, roomNumber, intent: 'parking_availability_query',
                    deterministic: 'parking_guard', ms: Date.now() - started },
          });
        }
      }
    }

    const intentPick = await chooseIntent(question, patterns);

    // Prefer service records linked to the matched intent; fall back to scoring
    let recordsToUse = [];
    if (intentPick.intent) {
      const p      = patterns.find(x => String(x.intent) === String(intentPick.intent));
      const svcIds = asArray(p?.servicesLink);
      if (svcIds.length) {
        const svcRecs = await airtableFindByIds(TABLE_SERVICES, svcIds, 30);
        const linked  = svcRecs.map(mapServiceRecord).filter(r =>
          r.active && allowForPWA(r.aiSource) && matchesHotelSlug(r.hotelSlugRaw, hotelSlug)
        );
        if (linked.length) recordsToUse = linked;
      }
    }
    if (!recordsToUse.length) {
      recordsToUse = pickFallbackRecords(question, pwaServices, 3);
    }

    // Output rule — prefer PWA scope, fall back to General/PWA
    const scopeWanted = intentPick?.outputScope || 'General';
    const outputRule  =
      await getOutputRule({ scopeWanted, aiSourceWanted: 'PWA' }) ||
      await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'PWA' });

    let answer = '';
    try {
      answer = await generateAnswerPwa({
        question, hotelSlug, lang, hotelRec, intentPick,
        recordsToUse, roomGuide, outputRule,
      });
    } catch (e) {
      if (e?._isRate || isOpenAIRateLimitError(e)) {
        return res.json({
          ok: true,
          answer: renderWait20s(lang),
          meta: { hotelSlug, roomNumber, ms: Date.now() - started, openai_rate_limited: true },
        });
      }
      throw e;
    }

    if (!answer) answer = renderNoInfo(lang);
    answer = stripChatWrap(answer);
    answer = applyPriceGuard(answer, { lang, hotelRec, recordsToUse });

    return res.json({
      ok: true,
      answer,
      meta: {
        hotelSlug,
        roomNumber,
        intent:            intentPick.intent,
        confidence:        intentPick.confidence ?? null,
        deterministic:     false,
        pwaServicesLoaded: pwaServices.length,
        roomGuideFound:    !!roomGuide,
        usedRecords:       recordsToUse.map(r => ({ type: r.type, naziv: r.naziv, id: r.id })),
        ms:                Date.now() - started,
      },
    });

  } catch (e) {
    console.error('pwa-ask error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers — guest request email alerts
// Provider: Brevo transactional email REST API (https://api.brevo.com/v3/smtp/email)
// Required env vars: BREVO_API_KEY, NOTIFICATION_FROM_EMAIL, NOTIFICATION_FROM_NAME
// If BREVO_API_KEY is absent the function skips silently and logs a warning.
// TODO: to switch provider replace the fetch() block inside _sendRequestNotification()
//       while keeping the _updateNotifStatus() calls intact.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write Notification Status / Sent At / Error back to a REQUESTS record.
 * Always called via .catch(() => {}) — never allowed to crash the caller.
 */
async function _updateNotifStatus(requestRecId, status, sentAt = null, errorMsg = '') {
  const fields = { 'Notification Status': status };
  if (sentAt)   fields['Notification Sent At'] = sentAt;
  if (errorMsg) fields['Notification Error']   = String(errorMsg).slice(0, 500);
  await base(TABLE_REQUESTS).update(requestRecId, fields);
}

/**
 * Build the plain-text email body for a guest request notification.
 * Message text is truncated to 1 500 characters; line breaks are preserved.
 */
function _buildRequestEmailBody({ hotelSlug, hotelName, roomNumber, category,
                                   message, guestName, priority, requestId }) {
  const ts      = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Zagreb' });
  const safeMsg = String(message || '').replace(/\r/g, '').slice(0, 1500);
  const sep     = '─'.repeat(44);
  const lines   = [
    'AI OLLY — Guest Request Notification',
    sep,
    `Hotel     : ${hotelName || hotelSlug}`,
    `Room      : ${roomNumber}`,
    `Category  : ${category}`,
    `Priority  : ${priority || 'Normal'}`,
    '',
    'Message:',
    safeMsg,
    '',
    sep,
  ];
  if (guestName)  lines.push(`Guest Name: ${guestName}`);
  lines.push(`Timestamp : ${ts}`);
  if (requestId) {
    lines.push(`Record ID : ${requestId}`);
    lines.push(`Airtable  : https://airtable.com/appon9UYjX6KU9cr1/tblYdzb9pRBFTRKFL/${requestId}`);
  }
  lines.push('', '— Sent by AI OLLY Notification Layer');
  return lines.join('\n');
}

/**
 * Send a guest request notification email via Brevo.
 * NEVER throws — all errors are caught, logged, and written back to Airtable.
 * Must be called fire-and-forget (.catch()) so the guest response is not blocked.
 *
 * Status outcomes written to REQUESTS:
 *   Sent                — Brevo accepted the message (2xx)
 *   Skipped - No Recipient — hotel has no Notification Email set
 *   Skipped - No Provider  — BREVO_API_KEY env var not configured
 *   Failed              — Brevo returned an error or fetch threw
 */
async function _sendRequestNotification({
  hotelSlug, hotelRec, roomNumber, category,
  message, guestName, priority, requestRecId,
}) {
  const recipientEmail = hotelRec?.notificationEmail || '';
  if (!recipientEmail) {
    console.log(`[notif] skipped — no recipient configured for "${hotelSlug}"`);
    return _updateNotifStatus(requestRecId, 'Skipped - No Recipient').catch(() => {});
  }

  const brevoKey  = process.env.BREVO_API_KEY          || '';
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'noreply@aiolly.pressmax.net';
  const fromName  = process.env.NOTIFICATION_FROM_NAME  || 'AI OLLY';

  if (!brevoKey) {
    console.log(`[notif] skipped — BREVO_API_KEY not set (hotel: "${hotelSlug}")`);
    return _updateNotifStatus(requestRecId, 'Skipped - No Provider').catch(() => {});
  }

  const subject  = `AI OLLY Guest Request — Room ${roomNumber}`;
  const textBody = _buildRequestEmailBody({
    hotelSlug,
    hotelName:  hotelRec?.hotelNaziv || hotelSlug,
    roomNumber, category, message, guestName, priority,
    requestId:  requestRecId,
  });

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': brevoKey },
      body:    JSON.stringify({
        sender:      { name: fromName, email: fromEmail },
        to:          [{ email: recipientEmail }],
        subject,
        textContent: textBody,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (resp.ok) {
      console.log(`[notif] sent → ${recipientEmail} | ${hotelSlug} room ${roomNumber}`);
      return _updateNotifStatus(requestRecId, 'Sent', new Date().toISOString()).catch(() => {});
    }

    const errBody = await resp.text().catch(() => `HTTP ${resp.status}`);
    const errMsg  = `HTTP ${resp.status}: ${errBody}`.slice(0, 500);
    console.warn(`[notif] send failed for "${hotelSlug}": ${errMsg}`);
    return _updateNotifStatus(requestRecId, 'Failed', null, errMsg).catch(() => {});

  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.warn(`[notif] send error for "${hotelSlug}": ${errMsg}`);
    return _updateNotifStatus(requestRecId, 'Failed', null, errMsg).catch(() => {});
  }
}

// -------------------------
// /api/pwa-request — guest submits a service request from the PWA
//
// Input:  { slug, room, token, category, message, guestName?, priority? }
// Auth:   Same ROOM GUIDE access-token validation as /api/pwa-ask (timing-safe)
// Write:  Creates one record in the REQUESTS table — no GPT involved
// -------------------------
app.post('/api/pwa-request', async (req, res) => {
  const started = Date.now();

  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug,  req.query?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room,  req.query?.room, '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');
    const category    = pickFirstNonEmpty(req.body?.category, '');
    const message     = pickFirstNonEmpty(req.body?.message, '');
    const guestName   = pickFirstNonEmpty(req.body?.guestName, req.body?.guest_name, '');
    const priority    = pickFirstNonEmpty(req.body?.priority, 'Normal');
    // Concierge extra fields
    const date        = pickFirstNonEmpty(req.body?.date, '');
    const time        = pickFirstNonEmpty(req.body?.time, '');
    const fromLoc     = pickFirstNonEmpty(req.body?.from, '');
    const toLoc       = pickFirstNonEmpty(req.body?.to, '');
    const guests      = req.body?.guests ? parseInt(req.body.guests, 10) : null;
    const partnerName = pickFirstNonEmpty(req.body?.partnerName, '');

    // ── Input validation ────────────────────────────────────────────────────────
    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });
    if (!category)   return res.status(400).json({ ok: false, error: 'Missing category' });
    if (!message)    return res.status(400).json({ ok: false, error: 'Missing message' });

    // ── Load ROOM GUIDE for token validation ────────────────────────────────────
    const roomGuide = await getRoomGuideRecord(hotelSlug, roomNumber);

    // ── Token validation — identical logic to /api/pwa-ask ───────────────────
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid = (
      token.length > 0 &&
      storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) return res.status(403).json({ ok: false, error: 'Access denied' });

    // ── Write to REQUESTS table ──────────────────────────────────────────────
    const fields = {
      'Hotel Slug':  hotelSlug,
      'Naziv sobe':  roomNumber,
      'Kategorija':  category,
      'Poruka':      message,
      'Status':      'New',
    };
    if (guestName)   fields['Gost - ime']    = guestName;
    if (priority)    fields['Prioritet']     = priority;
    if (date)        fields['Datum']         = date;
    if (time)        fields['Vrijeme']       = time;
    if (fromLoc)     fields['Odakle']        = fromLoc;
    if (toLoc)       fields['Kamo']          = toLoc;
    if (guests)      fields['Broj osoba']    = guests;
    if (partnerName) fields['Partner naziv'] = partnerName;

    const created = await base(TABLE_REQUESTS).create(fields);

    // ── Fire-and-forget notification ─────────────────────────────────────────
    // Loads hotel record (cached) and sends email alert. Never blocks the guest
    // response — errors are swallowed here and written back to the REQUESTS record.
    getHotelRecord(hotelSlug)
      .then(hotelRec => _sendRequestNotification({
        hotelSlug, hotelRec, roomNumber, category,
        message, guestName, priority, requestRecId: created.id,
      }))
      .catch(e => console.error('[notif] fire-and-forget error:', e.message));

    return res.status(201).json({
      ok:        true,
      requestId: created.id,
      meta: {
        hotelSlug,
        roomNumber,
        category,
        priority: fields['Prioritet'] ?? 'Normal',
        ms: Date.now() - started,
      },
    });

  } catch (e) {
    console.error('pwa-request error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-welcome — load room-specific welcome text for the PWA landing screen
//
// Input:  { slug, room, token }
// Auth:   Same ROOM GUIDE token validation as /api/pwa-ask (timing-safe)
// Output: { ok, hotelName, aiWelcome }
// -------------------------
app.post('/api/pwa-welcome', async (req, res) => {
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug, req.query?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room, req.query?.room, '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const [hotelRec, roomGuide] = await Promise.all([
      getHotelRecord(hotelSlug),
      getRoomGuideRecord(hotelSlug, roomNumber),
    ]);

    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid = (
      token.length > 0 &&
      storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) return res.status(403).json({ ok: false, error: 'Access denied' });

    // Room type — read directly from the ROOM GUIDE record's 'Room Type' field.
    // Previously used a SOBE table lookup (getRoomsRaw), which always returned empty
    // because SOBE records are named by type ("Deluxe room"), not by number ("101").
    const roomType = roomGuide?.tipSobe || '';

    return res.json({
      ok:             true,
      hotelName:      hotelRec?.hotelNaziv ?? '',
      roomType,
      aiWelcome:      roomGuide?.aiWelcome ?? '',
      googleReviewUrl: hotelRec?.googleReview ?? '',
    });

  } catch (e) {
    console.error('pwa-welcome error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-room-guide — return room-specific guide content
//
// Input:  { slug, room, token }
// Auth:   Same ROOM GUIDE access-token validation as /api/pwa-ask (timing-safe)
// Output: { ok, wifi, klimaUpute, tvUpute, sefUpute, roomFeatures, napomene, aiWelcome }
// -------------------------
app.post('/api/pwa-room-guide', async (req, res) => {
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug,  req.query?.slug,  HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room,  req.query?.room,  '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const roomGuide = await getRoomGuideRecord(hotelSlug, roomNumber);

    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid = (
      token.length > 0 &&
      storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) {
      console.warn(`[pwa-room-guide] 403: slug=${hotelSlug} room=${roomNumber} token_len=${token.length} stored_len=${storedToken.length} room_found=${roomGuide !== null}`);
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    return res.json({
      ok:           true,
      wifi:         roomGuide?.wifi         ?? '',
      klimaUpute:   roomGuide?.klimaUpute   ?? '',
      tvUpute:      roomGuide?.tvUpute      ?? '',
      sefUpute:     roomGuide?.sefUpute     ?? '',
      roomFeatures: roomGuide?.roomFeatures ?? '',
      napomene:     roomGuide?.napomene     ?? '',
      aiWelcome:    roomGuide?.aiWelcome    ?? '',
    });

  } catch (e) {
    console.error('pwa-room-guide error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-services — return hotel services list for the PWA
//
// Input:  { slug, room, token }
// Auth:   Same ROOM GUIDE access-token validation as /api/pwa-ask (timing-safe)
// Output: { ok, services: [{ id, naziv, opis, radnoVrijeme, kategorija, aiIntent }] }
// -------------------------
app.post('/api/pwa-services', async (req, res) => {
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug,  req.query?.slug,  HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room,  req.query?.room,  '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const roomGuide = await getRoomGuideRecord(hotelSlug, roomNumber);

    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid = (
      token.length > 0 &&
      storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) {
      console.warn(`[pwa-services] 403: slug=${hotelSlug} room=${roomNumber} token_len=${token.length} stored_len=${storedToken.length} room_found=${roomGuide !== null}`);
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const rawServices = await getServicesForHotelPwa(hotelSlug);

    const services = rawServices.map(s => ({
      id:           s.id,
      naziv:        s.naziv         || '',
      opis:         s.opis          || '',
      radnoVrijeme: s.radnoVrijeme  || '',
      kategorija:   Array.isArray(s.kategorija) ? s.kategorija : [],
      aiIntent:     Array.isArray(s.aiIntent)   ? s.aiIntent   : [],
    }));

    return res.json({ ok: true, services });

  } catch (e) {
    console.error('pwa-services error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── POI + ROUTES record mappers ───────────────────────────────────────────

function mapPoiRecord(rec) {
  const f   = rec.fields || {};
  // Actual Airtable field names confirmed: POI Naziv, Kategorije, Opis (kratki/hook),
  // Opis (dugi), Trajanje posjeta (min), Udaljenost od hotela. No lat/lng fields.
  const lat = parseFloat(f.Latitude  ?? f.Lat ?? f.lat ?? '');
  const lng = parseFloat(f.Longitude ?? f.Lng ?? f.lng ?? '');
  const hasCoords = isFinite(lat) && isFinite(lng);

  const name = pickFirstNonEmpty(f['POI Naziv'], f.Name, f.Naziv, f.naziv, '');

  // Fall back to name-based Maps search if no coords
  const nav = pickFirstNonEmpty(f['Google Maps URL'], f['Maps URL'], '') ||
    (hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : (name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ', Split')}` : ''));

  return {
    id:        rec.id,
    name,
    category:  pickFirstNonEmpty(f.Kategorije, f.Category, f.Kategorija, f.kategorija, ''),
    city:      pickFirstNonEmpty(f.City,  f.Grad,   f.grad,   'Split'),
    shortDesc: pickFirstNonEmpty(f['Opis (kratki/hook)'], f['Short Description'], f['Kratki opis'], f['kratki opis'], ''),
    longDesc:  pickFirstNonEmpty(f['Opis (dugi)'], f['Long Description'], f['Dugi opis'], f.Opis, f.opis, ''),
    visit:     pickFirstNonEmpty(f['Trajanje posjeta (min)'], f['Visit Duration'], f['Trajanje posjete'], f.Trajanje, f.trajanje, ''),
    dist:      pickFirstNonEmpty(f['Udaljenost od hotela'], f['Distance from Hotel'], f.Udaljenost, f.udaljenost, ''),
    coords:    hasCoords ? { lat, lng } : null,
    nav,
  };
}

function mapRouteRecord(rec) {
  const f        = rec.fields || {};
  // Actual Airtable field names confirmed: Ruta naziv, Tip rute, Trajanje (min), Opis rute.
  // No Start Lat/Lng or POI linked fields in current schema.
  const startLat = parseFloat(f['Start Lat'] ?? f['Start Latitude'] ?? '');
  const startLng = parseFloat(f['Start Lng'] ?? f['Start Longitude'] ?? '');
  const hasStart = isFinite(startLat) && isFinite(startLng);
  const rawPois  = f.POIs ?? f['POI'] ?? f.Pois ?? [];
  return {
    id:               rec.id,
    name:             pickFirstNonEmpty(f['Ruta naziv'], f.Name, f.Naziv, f.naziv, ''),
    type:             pickFirstNonEmpty(f['Tip rute'], f.Type, f.Tip, f.tip, ''),
    duration:         pickFirstNonEmpty(f['Trajanje (min)'], f.Duration, f.Trajanje, f.trajanje, ''),
    shortDesc:        pickFirstNonEmpty(f['Short Description'], f['Kratki opis'], ''),
    longDesc:         pickFirstNonEmpty(f['Opis rute'], f.Description, f.Opis, f['Long Description'], f.opis, ''),
    startPointName:   pickFirstNonEmpty(f['Start Point'], f['Početak'], f['Pocetak'], ''),
    startPointCoords: hasStart ? { lat: startLat, lng: startLng } : null,
    poiIds:           Array.isArray(rawPois) ? rawPois : [],
    profile:          pickFirstNonEmpty(f['Guest Profile'], f['Profil gosta'], f.Profil, f.profil, ''),
  };
}

// -------------------------
// /api/pwa-pois — return curated POI list for the PWA city layer
//
// Input:  { slug, room, token }
// Auth:   Same ROOM GUIDE access-token validation (timing-safe)
// Output: { ok, pois: [{ id, name, category, city, shortDesc, longDesc,
//                        visit, dist, coords, nav }] }
// -------------------------
app.post('/api/pwa-pois', async (req, res) => {
  const started = Date.now();
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug,  req.query?.slug,  HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room,  req.query?.room,  '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const roomGuide   = await getRoomGuideRecord(hotelSlug, roomNumber);
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid  = (
      token.length > 0 && storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) {
      console.warn(`[pwa-pois] 403: slug=${hotelSlug} room=${roomNumber} token_len=${token.length} stored_len=${storedToken.length} room_found=${roomGuide !== null}`);
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const slugEsc = escapeAirtableFormulaString(hotelSlug);
    const recs = await airtableSelectAllSafe(
      TABLE_POI,
      [{ pageSize: 100, filterByFormula: `FIND("${slugEsc}", ARRAYJOIN({Hotel Slug}))` }]
    );

    // If hotel-filtered fetch returns nothing, fall back to all POI records
    const allRecs = recs.length ? recs : await airtableSelectAllSafe(
      TABLE_POI,
      [{ pageSize: 100 }]
    );

    const pois = allRecs.map(mapPoiRecord).filter(p => p.name);

    return res.json({
      ok:   true,
      pois,
      meta: { hotelSlug, count: pois.length, ms: Date.now() - started },
    });

  } catch (e) {
    console.error('pwa-pois error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-routes — return curated routes for the PWA city layer
//
// Input:  { slug, room, token }
// Auth:   Same ROOM GUIDE access-token validation (timing-safe)
// Output: { ok, routes: [{ id, name, type, duration, shortDesc, longDesc,
//                          startPointName, startPointCoords, poiIds, profile }] }
// -------------------------
app.post('/api/pwa-routes', async (req, res) => {
  const started = Date.now();
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug,  req.query?.slug,  HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room,  req.query?.room,  '');
    const token      = pickFirstNonEmpty(req.body?.token, req.query?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const roomGuide   = await getRoomGuideRecord(hotelSlug, roomNumber);
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid  = (
      token.length > 0 && storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) {
      console.warn(`[pwa-routes] 403: slug=${hotelSlug} room=${roomNumber} token_len=${token.length} stored_len=${storedToken.length} room_found=${roomGuide !== null}`);
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    const slugEsc = escapeAirtableFormulaString(hotelSlug);
    const recs = await airtableSelectAllSafe(
      TABLE_ROUTES,
      [{ pageSize: 100, filterByFormula: `FIND("${slugEsc}", ARRAYJOIN({Hotel Slug}))` }]
    );

    const allRecs = recs.length ? recs : await airtableSelectAllSafe(
      TABLE_ROUTES,
      [{ pageSize: 100 }]
    );

    const routes = allRecs.map(mapRouteRecord).filter(r => r.name);

    return res.json({
      ok:     true,
      routes,
      meta: { hotelSlug, count: routes.length, ms: Date.now() - started },
    });

  } catch (e) {
    console.error('pwa-routes error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/pwa-partners — partner restaurants / experiences for Concierge ──────
//
// Input:  { slug, room, token }
// Output: { ok, partners: [{ id, name, category, description, cuisine,
//            atmosphere, address, mapsUrl, hours, price, phone }] }
// -------------------------
app.post('/api/pwa-partners', async (req, res) => {
  const started = Date.now();
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room, '');
    const token      = pickFirstNonEmpty(req.body?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    const roomGuide   = await getRoomGuideRecord(hotelSlug, roomNumber);
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid  = token.length > 0 && storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken));
    if (!tokenValid) return res.status(403).json({ ok: false, error: 'Access denied' });

    const allRecs = await airtableSelectAllSafe(
      base(TABLE_PARTNERS),
      `{Hotel Slug} = "${hotelSlug}"`,
      `Hotel Slug`,
      hotelSlug,
      [{ pageSize: 100 }]
    );

    const partners = allRecs
      .filter(r => r.fields['Aktivno'] === true)
      .map(r => {
        const f = r.fields;
        return {
          id:          r.id,
          name:        f['Naziv']         || '',
          category:    f['Kategorija']    || 'Restaurant',
          description: f['Opis']          || '',
          cuisine:     f['Kuhinja']       || '',
          atmosphere:  f['Atmosfera']     || '',
          address:     f['Adresa']        || '',
          mapsUrl:     f['Google Maps']   || '',
          hours:       f['Radno vrijeme'] || '',
          price:       f['Cijena']        || '',
          phone:       f['Telefon']       || '',
        };
      });

    return res.json({ ok: true, partners, meta: { count: partners.length, ms: Date.now() - started } });
  } catch (e) {
    console.error('pwa-partners error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/pwa-push-subscribe — save guest push subscription ───────────────────
//
// Input:  { slug, room, token, subscription }  (subscription = PushSubscription JSON)
// Stores in memory: Map key `${slug}:${room}`
// -------------------------
app.post('/api/pwa-push-subscribe', async (req, res) => {
  try {
    const hotelSlug    = pickFirstNonEmpty(req.body?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber   = pickFirstNonEmpty(req.body?.room, '');
    const token        = pickFirstNonEmpty(req.body?.token, '');
    const subscription = req.body?.subscription;

    if (!roomNumber || !subscription) return res.status(400).json({ ok: false, error: 'Missing room or subscription' });

    const roomGuide   = await getRoomGuideRecord(hotelSlug, roomNumber);
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid  = token.length > 0 && storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken));
    if (!tokenValid) return res.status(403).json({ ok: false, error: 'Access denied' });

    const key = `${hotelSlug}:${roomNumber}`;
    const existing = pushSubscriptions.get(key);
    pushSubscriptions.set(key, { sub: subscription, airtableId: existing?.airtableId || null });

    // Persist to Airtable (non-blocking — don't fail if Airtable is slow)
    savePushSubscriptionToAirtable(hotelSlug, roomNumber, subscription).then(airtableId => {
      if (airtableId) {
        const entry = pushSubscriptions.get(key);
        if (entry) entry.airtableId = airtableId;
      }
    });

    console.log(`[push] Subscription saved for ${key}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('pwa-push-subscribe error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/pwa-push-key — return VAPID public key to PWA ───────────────────────
app.get('/api/pwa-push-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ ok: false, error: 'Push not configured' });
  res.json({ ok: true, publicKey: VAPID_PUBLIC_KEY });
});

// ── /api/webhook/request-status — Airtable Automation calls this when ────────
//   a REQUESTS record Status changes → send push notification to guest
//
// Input (from Airtable Automation):
//   { secret, hotelSlug, room, requestId, status, category }
// -------------------------
app.post('/api/webhook/request-status', async (req, res) => {
  try {
    const secret     = pickFirstNonEmpty(req.body?.secret, req.headers['x-webhook-secret'], '');
    const hotelSlug  = pickFirstNonEmpty(req.body?.hotelSlug, req.body?.hotel_slug, '');
    const roomNumber = pickFirstNonEmpty(req.body?.room, req.body?.nazivSobe, '');
    const status     = pickFirstNonEmpty(req.body?.status, '');
    const category   = pickFirstNonEmpty(req.body?.category, req.body?.requestType, 'Request');

    // Verify webhook secret
    if (secret !== WEBHOOK_SECRET) {
      console.warn('[webhook] Invalid secret');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    if (!hotelSlug || !roomNumber || !status) {
      return res.status(400).json({ ok: false, error: 'Missing hotelSlug, room, or status' });
    }

    // Build notification payload
    const statusMessages = {
      'Acknowledged': { title: '✓ Request Received', body: `Your ${category} request has been acknowledged. We'll be in touch shortly.` },
      'In Progress':  { title: '⚙ In Progress', body: `Your ${category} request is being processed by our team.` },
      'Resolved':     { title: '✅ Confirmed', body: `Your ${category} request has been confirmed. Please contact reception for details.` },
    };
    const notif = statusMessages[status] || { title: 'Request Update', body: `Your request status: ${status}` };

    const payload = JSON.stringify({
      title: notif.title,
      body:  notif.body,
      tag:   'concierge-update',
      url:   '/pwa/',
    });

    // Find push subscription
    const key = `${hotelSlug}:${roomNumber}`;
    const entry = pushSubscriptions.get(key);

    if (!entry) {
      console.warn(`[webhook] No push subscription for ${key}`);
      return res.json({ ok: true, pushed: false, reason: 'No subscription on record' });
    }

    await webpush.sendNotification(entry.sub, payload);
    console.log(`[webhook] Push sent to ${key} — status: ${status}`);

    return res.json({ ok: true, pushed: true });
  } catch (e) {
    console.error('webhook/request-status error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// -------------------------
// /api/pwa-events — return upcoming local events for a hotel
//
// Input:  { slug }
// Output: { ok, events: [{ id, name, date, description, link }] }
// -------------------------
app.post('/api/pwa-events', async (req, res) => {
  try {
    const hotelSlug = pickFirstNonEmpty(req.body?.slug, req.query?.slug, HOTEL_SLUG_DEFAULT);
    const slugEsc   = escapeAirtableFormulaString(hotelSlug);
    const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Fetch dated events (today + future) AND always-on entries together
    const recs = await airtableSelectAll(TABLE_EVENTS, {
      filterByFormula: `AND({HotelSlug}="${slugEsc}", {Aktivan}=TRUE(), OR({Tip}="Always on", {Datum}>="${today}"))`,
      sort: [{ field: 'Datum', direction: 'asc' }],
      pageSize: 100,
    });

    const events = recs.map(r => ({
      id:          r.id,
      name:        r.fields['Naziv']     || '',
      date:        r.fields['Datum']     || '',
      description: r.fields['Opis']      || '',
      link:        r.fields['Link']      || '',
      tip:         r.fields['Tip']       || 'Event',
    }));

    return res.json({ ok: true, events });
  } catch (e) {
    console.error('pwa-events error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/pwa-feedback — save guest feedback after checkout ───────────────────
//
// Input:  { slug, room, token, overall, room_score, staff, location, cleanliness, comment }
// Output: { ok, feedbackId }
// -------------------------
app.post('/api/pwa-feedback', async (req, res) => {
  try {
    const hotelSlug  = pickFirstNonEmpty(req.body?.slug, HOTEL_SLUG_DEFAULT);
    const roomNumber = pickFirstNonEmpty(req.body?.room, '');
    const token      = pickFirstNonEmpty(req.body?.token, '');

    if (!roomNumber) return res.status(400).json({ ok: false, error: 'Missing room' });

    // Token validation
    const roomGuide   = await getRoomGuideRecord(hotelSlug, roomNumber);
    const storedToken = roomGuide?.accessToken ?? '';
    const tokenValid  = (
      token.length > 0 && storedToken.length > 0 &&
      token.length === storedToken.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(storedToken))
    );
    if (!tokenValid) return res.status(403).json({ ok: false, error: 'Access denied' });

    const toInt = v => { const n = parseInt(v, 10); return isNaN(n) ? null : Math.min(5, Math.max(1, n)); };

    const fields = {
      'HotelSlug': hotelSlug,
      'Soba':      roomNumber,
      'Datum':     new Date().toISOString().slice(0, 10),
    };
    const overall     = toInt(req.body?.overall);
    const roomScore   = toInt(req.body?.room_score);
    const staff       = toInt(req.body?.staff);
    const location    = toInt(req.body?.location);
    const cleanliness = toInt(req.body?.cleanliness);
    const comment     = pickFirstNonEmpty(req.body?.comment, '');

    if (overall     !== null) fields['Overall']      = overall;
    if (roomScore   !== null) fields['Soba ocjena']  = roomScore;
    if (staff       !== null) fields['Osoblje']      = staff;
    if (location    !== null) fields['Lokacija']     = location;
    if (cleanliness !== null) fields['Čistoća']      = cleanliness;
    if (comment)              fields['Komentar']     = comment;

    const created = await base(TABLE_FEEDBACK).create(fields);
    return res.status(201).json({ ok: true, feedbackId: created.id });

  } catch (e) {
    console.error('pwa-feedback error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/webhook/checkout — Airtable fires this when room Status → Checkout ──
//
// Input:  { secret, hotelSlug, room }
// Action: sends push notification to guest → opens PWA feedback screen
// -------------------------
app.post('/api/webhook/checkout', async (req, res) => {
  try {
    const secret    = pickFirstNonEmpty(req.body?.secret, req.headers['x-webhook-secret'], '');
    const hotelSlug = pickFirstNonEmpty(req.body?.hotelSlug, req.body?.hotel_slug, '');
    const room      = pickFirstNonEmpty(req.body?.room, '');

    if (secret !== WEBHOOK_SECRET) {
      console.warn('[webhook/checkout] Invalid secret');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (!hotelSlug || !room) {
      return res.status(400).json({ ok: false, error: 'Missing hotelSlug or room' });
    }

    const payload = JSON.stringify({
      title: '🙏 Thank you for staying with us!',
      body:  'We\'d love to hear about your experience. Tap to leave feedback.',
      tag:   'checkout-feedback',
      url:   '/pwa/?feedback=1',
    });

    const key   = `${hotelSlug}:${room}`;
    const entry = pushSubscriptions.get(key);

    if (!entry) {
      console.warn(`[webhook/checkout] No push subscription for ${key}`);
      return res.json({ ok: true, pushed: false, reason: 'No subscription on record' });
    }

    await webpush.sendNotification(entry.sub, payload);
    console.log(`[webhook/checkout] Checkout push sent to ${key}`);
    return res.json({ ok: true, pushed: true });

  } catch (e) {
    console.error('webhook/checkout error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/webhook/novosti — Airtable fires when new NOVOSTI record created ────
//
// Input:  { secret, hotelSlug, naslov, poruka, recordId }
// Action: sends push to ALL active subscribers of the hotel, marks record Sent
// -------------------------
app.post('/api/webhook/novosti', async (req, res) => {
  try {
    const secret    = pickFirstNonEmpty(req.body?.secret, req.headers['x-webhook-secret'], '');
    const hotelSlug = pickFirstNonEmpty(req.body?.hotelSlug, HOTEL_SLUG_DEFAULT);
    const naslov    = pickFirstNonEmpty(req.body?.naslov, '');
    const poruka    = pickFirstNonEmpty(req.body?.poruka, '');
    const recordId  = pickFirstNonEmpty(req.body?.recordId, '');

    if (secret !== WEBHOOK_SECRET) {
      console.warn('[webhook/novosti] Invalid secret');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    // Resolve hotel display name for push notification title/body fallbacks.
    // Fallback order: HOTELI.Hotel naziv → slug → 'AI OLLY'
    const _hotelRecNotif = await getHotelRecord(hotelSlug).catch(() => null);
    const _hotelDisplay  = _hotelRecNotif?.hotelNaziv || hotelSlug || 'AI OLLY';

    const payload = JSON.stringify({
      title: naslov || _hotelDisplay,
      body:  poruka || `News from ${_hotelDisplay}`,
      tag:   'hotel-news',
      url:   '/pwa/',
    });

    // Send to all subscribers of this hotel
    const hotelEntries = [...pushSubscriptions.entries()]
      .filter(([key]) => key.startsWith(`${hotelSlug}:`));

    let sent = 0, failed = 0;
    await Promise.allSettled(
      hotelEntries.map(async ([key, entry]) => {
        try {
          await webpush.sendNotification(entry.sub, payload);
          sent++;
        } catch (e) {
          console.warn(`[webhook/novosti] Push failed for ${key}:`, e.message);
          // If subscription expired/invalid, deactivate in Airtable
          if (e.statusCode === 410 && entry.airtableId) {
            base(TABLE_PUSH_SUBS).update(entry.airtableId, { 'Active': false }).catch(() => {});
            pushSubscriptions.delete(key);
          }
          failed++;
        }
      })
    );

    console.log(`[webhook/novosti] Broadcast to ${hotelSlug}: ${sent} sent, ${failed} failed`);

    // Mark NOVOSTI record as Sent
    if (recordId) {
      try {
        await base(TABLE_NOVOSTI).update(recordId, { 'Status': 'Sent' });
      } catch (_) { /* non-critical */ }
    }

    return res.json({ ok: true, sent, failed, total: hotelEntries.length });
  } catch (e) {
    console.error('webhook/novosti error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/reception/create-consent-session ────────────────────────────────────
//
// Called by reception tablet/software to generate a short-lived consent URL.
// WEBHOOK_SECRET stays in the POST body — never in a browser URL.
//
// Input:  { secret, slug, room, name?, email?, guestId?, stayId? }
// Output: { ok, token, consentUrl, expires }
//         consentUrl = /reception/consent.html?token=<64-char-hex>
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/reception/create-consent-session', async (req, res) => {
  try {
    const {
      secret  = '',
      slug    = HOTEL_SLUG_DEFAULT,
      room    = '',
      name    = '',
      email   = '',
      guestId = '',
      stayId  = '',
    } = req.body || {};

    if (secret !== WEBHOOK_SECRET) {
      console.warn('[consent-session] Invalid secret');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (!room) {
      return res.status(400).json({ ok: false, error: 'Missing room' });
    }

    purgeExpiredConsentSessions();

    const token   = generateConsentToken();
    const expires = Date.now() + CONSENT_TOKEN_TTL_MS;

    consentSessions.set(token, {
      slug,
      room,
      name:    name.trim(),
      email:   email.trim(),
      guestId: guestId.trim(),
      stayId:  stayId.trim(),
      expires,
      used: false,
    });

    const consentUrl = `/reception/consent.html?token=${token}`;

    console.log(`[consent-session] Created token for ${slug}:${room} (guestId=${guestId || '—'} stayId=${stayId || '—'}) expires=${new Date(expires).toISOString()}`);
    return res.json({ ok: true, token, consentUrl, expires });
  } catch (e) {
    console.error('create-consent-session error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/reception/consent-context ────────────────────────────────────────────
//
// Called by consent.html on load to retrieve session context for a token.
// No secret required — token itself is the credential.
//
// Input:  GET ?token=...  (or POST { token })
// Output: { ok, slug, room, name, email, guestId, stayId } | { ok:false, error, expired? }
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/reception/consent-context', (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

  const session = consentSessions.get(token);
  if (!session) return res.status(404).json({ ok: false, error: 'Token not found or already expired' });
  if (Date.now() > session.expires) {
    consentSessions.delete(token);
    return res.status(410).json({ ok: false, error: 'Token expired', expired: true });
  }
  if (session.used) {
    return res.status(409).json({ ok: false, error: 'Token already used', used: true });
  }

  return res.json({
    ok:      true,
    slug:    session.slug,
    room:    session.room,
    name:    session.name,
    email:   session.email,
    guestId: session.guestId,
    stayId:  session.stayId,
  });
});

// ── /api/reception/init-consent ───────────────────────────────────────────────
//
// Called by start-consent.html (tablet browser) to generate a consent token
// from a Stay record ID.  Auth uses RECEPTION_PIN (not WEBHOOK_SECRET).
//
// Input:  POST { stayId, pin }
// Output: { ok, consentUrl, room, name }
//
// The endpoint resolves room number + guest info from Airtable so that no
// sensitive data needs to be embedded in the Airtable button URL.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/reception/init-consent', async (req, res) => {
  try {
    const { stayId = '', pin = '' } = req.body || {};

    if (!RECEPTION_PIN || pin !== RECEPTION_PIN) {
      console.warn('[init-consent] Invalid PIN');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (!stayId) {
      return res.status(400).json({ ok: false, error: 'Missing stayId' });
    }

    // ── Fetch Stay record ──────────────────────────────────────────────────
    const stayRecord  = await base(TABLE_STAYS).find(stayId);
    const stayFields  = stayRecord.fields;

    // ── Resolve room number ────────────────────────────────────────────────
    // Prefer linked SOBE record → Soba oznaka; fall back to parsing Naziv.
    let room = '';
    const sobaIds = stayFields['Soba'] || [];
    if (sobaIds.length > 0) {
      try {
        const sobaRecord = await base(TABLE_ROOMS).find(sobaIds[0]);
        room = sobaRecord.fields['Soba oznaka'] || '';
      } catch { /* not critical */ }
    }
    if (!room) {
      const naziv = stayFields['Naziv'] || '';
      const parts = naziv.split(' - ');
      if (parts.length >= 2) {
        room = parts[1].trim();
      } else {
        const m = naziv.match(/\b(\d{2,4})\b/);
        if (m) room = m[1];
      }
    }
    if (!room) {
      return res.status(422).json({ ok: false, error: 'Cannot determine room from Stay record' });
    }

    // ── Resolve guest name + email ─────────────────────────────────────────
    const guestIds = stayFields['Gost'] || [];
    const guestId  = guestIds[0] || '';
    let name = '', email = '';
    if (guestId) {
      const guestRecord = await base(TABLE_GUESTS).find(guestId);
      const gf = guestRecord.fields;
      name  = (gf['Ime Prezime'] || `${gf['Ime'] || ''} ${gf['Prezime'] || ''}`.trim()).trim();
      email = gf['Email'] || '';
    }

    // ── Create consent session ─────────────────────────────────────────────
    purgeExpiredConsentSessions();
    const token   = generateConsentToken();
    const expires = Date.now() + CONSENT_TOKEN_TTL_MS;

    consentSessions.set(token, {
      slug:    stayFields['HotelSlug'] || HOTEL_SLUG_DEFAULT,
      room,
      name,
      email,
      guestId,
      stayId:  stayRecord.id,
      expires,
      used:    false,
    });

    const consentUrl = `/reception/consent.html?token=${token}`;
    console.log(`[init-consent] Token for stay=${stayId} room=${room} guest=${guestId || '—'}`);
    return res.json({ ok: true, consentUrl, room, name });
  } catch (e) {
    console.error('[init-consent] error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/reception/save-guest — upsert a GUESTS record ────────────────────────
//
// Input:  { secret, slug, ime, prezime, email, telefon, drzava, napomene }
// Action: finds existing GUESTS record by email (if provided) or creates new one.
//         Returns { ok, guestId, created }.
// -------------------------
app.post('/api/reception/save-guest', async (req, res) => {
  try {
    const {
      secret    = '',
      slug      = HOTEL_SLUG_DEFAULT,
      ime       = '',
      prezime   = '',
      email     = '',
      telefon   = '',
      drzava    = '',
      napomene  = '',
    } = req.body || {};

    if (secret !== WEBHOOK_SECRET) {
      console.warn('[reception/save-guest] Invalid secret');
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    if (!ime && !prezime && !email) {
      return res.status(400).json({ ok: false, error: 'Missing guest data' });
    }

    // Try to find existing guest by email
    let guestId = null;
    let created = false;
    if (email) {
      const existing = await airtableSelectAll(TABLE_GUESTS, {
        filterByFormula: `AND({Email}="${email}", {HotelSlug}="${slug}")`,
        maxRecords: 1,
      });
      if (existing.length > 0) {
        guestId = existing[0].id;
      }
    }

    if (!guestId) {
      const imePrezime = [ime, prezime].filter(Boolean).join(' ');
      const rec = await base(TABLE_GUESTS).create({
        'Ime Prezime': imePrezime,
        'Ime':         ime,
        'Prezime':     prezime,
        'Email':       email || '',
        'Telefon':     telefon || '',
        'Država':      drzava || '',
        'HotelSlug':   slug,
        'Napomene':    napomene || '',
      });
      guestId = rec.id;
      created = true;
    }

    console.log(`[reception/save-guest] ${created ? 'Created' : 'Found'} guest ${guestId} (${email || ime})`);
    return res.json({ ok: true, guestId, created });

  } catch (e) {
    console.error('reception/save-guest error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── /api/reception/save-consent — save guest GDPR consent + signature ─────────
//
// Accepts TWO auth modes:
//   A) token-based (preferred): { token, gdpr, marketing, newsletter, signature, name?, email? }
//      token is resolved against consentSessions — single-use, expires in 2h.
//      slug/room/guestId/stayId come from the session; name/email can be overridden.
//   B) legacy secret-based (kept for backward compat):
//      { secret, slug, room, name, email, gdpr, marketing, newsletter, signature, guestId? }
//
// signature = data:image/png;base64,...
// Action: creates PRIVOLE record, uploads PNG as Airtable attachment,
//         optionally links to GUESTS and/or STAYS record, marks token used.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/reception/save-consent', async (req, res) => {
  try {
    const body = req.body || {};

    let slug, room, name, email, guestId, stayId, resolvedToken;

    if (body.token) {
      // ── Mode A: token-based ───────────────────────────────────────────────
      resolvedToken = (body.token || '').trim();
      const session = consentSessions.get(resolvedToken);
      if (!session) {
        return res.status(404).json({ ok: false, error: 'Token not found or already expired' });
      }
      if (Date.now() > session.expires) {
        consentSessions.delete(resolvedToken);
        return res.status(410).json({ ok: false, error: 'Token expired', expired: true });
      }
      if (session.used) {
        return res.status(409).json({ ok: false, error: 'Token already used. Generate a new consent session.', used: true });
      }
      slug    = session.slug;
      room    = session.room;
      // name/email: use body override if provided (guest may correct prefill), else session value
      name    = (body.name  || '').trim() || session.name;
      email   = (body.email || '').trim() || session.email;
      guestId = session.guestId;
      stayId  = session.stayId;
    } else {
      // ── Mode B: legacy secret-based ──────────────────────────────────────
      const secret = body.secret || '';
      if (secret !== WEBHOOK_SECRET) {
        console.warn('[reception/save-consent] Invalid secret');
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      slug    = body.slug    || HOTEL_SLUG_DEFAULT;
      room    = body.room    || '';
      name    = (body.name   || '').trim();
      email   = (body.email  || '').trim();
      guestId = body.guestId || '';
      stayId  = '';
    }

    const gdpr       = body.gdpr       ?? false;
    const marketing  = body.marketing  ?? false;
    const newsletter = body.newsletter ?? false;
    const signature  = body.signature  || '';

    if (!room || !name || !gdpr) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: room, name, gdpr' });
    }

    // 1. Build PRIVOLE fields — link to GUESTS and/or STAYS if IDs provided
    const privoleFields = {
      'Ime gosta':  name,
      'Email':      email || '',
      'Soba':       room,
      'HotelSlug':  slug,
      'GDPR':       !!gdpr,
      'Marketing':  !!marketing,
      'Newsletter': !!newsletter,
      'Datum':      new Date().toISOString(),
    };
    if (guestId) privoleFields['Gost']    = [guestId];
    if (stayId)  privoleFields['Boravak'] = [stayId];

    // 2. Create PRIVOLE record (without attachment first)
    const record = await base(TABLE_PRIVOLE).create(privoleFields);

    const recordId = record.id;

    // 2. Upload signature PNG as Airtable attachment
    if (signature && signature.startsWith('data:image/png;base64,')) {
      try {
        const base64Data = signature.replace('data:image/png;base64,', '');
        const pngBuffer  = Buffer.from(base64Data, 'base64');
        const filename   = `sig_${slug}_${room}_${Date.now()}.png`;

        // Airtable Content API — direct file upload
        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const nl = '\r\n';
        const header =
          `--${boundary}${nl}` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"${nl}` +
          `Content-Type: image/png${nl}${nl}`;
        const footer = `${nl}--${boundary}--${nl}`;

        const headerBuf = Buffer.from(header, 'utf8');
        const footerBuf = Buffer.from(footer, 'utf8');
        const body = Buffer.concat([headerBuf, pngBuffer, footerBuf]);

        const uploadResp = await fetch(
          `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/uploadAttachment/Potpis`,
          {
            method: 'POST',
            headers: {
              'Authorization':  `Bearer ${AIRTABLE_API_KEY}`,
              'Content-Type':   `multipart/form-data; boundary=${boundary}`,
              'Content-Length': String(body.length),
            },
            body,
          }
        );

        if (!uploadResp.ok) {
          const errText = await uploadResp.text();
          console.warn('[reception] Attachment upload failed:', uploadResp.status, errText);
          // Non-fatal — record is already saved, just without attachment
        } else {
          console.log(`[reception] Signature uploaded for ${slug}:${room} (record ${recordId})`);
        }
      } catch (e) {
        console.warn('[reception] Signature upload error:', e.message);
        // Non-fatal
      }
    }

    // Mark token as used (single-use enforcement)
    if (resolvedToken) {
      const session = consentSessions.get(resolvedToken);
      if (session) session.used = true;
    }

    console.log(`[reception] Consent saved: ${slug}:${room} — ${name} | GDPR=${gdpr} mkt=${marketing} nl=${newsletter} | guest=${guestId || '—'} stay=${stayId || '—'}`);
    return res.json({ ok: true, recordId, room, name });

  } catch (e) {
    console.error('reception/save-consent error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── AI CATHEDRA — Prijave ispita iz PWA
// ═══════════════════════════════════════════════════════════════════════════════

const CATHEDRA_BASE_ID = process.env.CATHEDRA_AIRTABLE_BASE_ID || '';
const CATHEDRA_API_KEY = process.env.CATHEDRA_AIRTABLE_API_KEY || '';
if (!CATHEDRA_BASE_ID || !CATHEDRA_API_KEY) {
  console.warn('⚠️  CATHEDRA_AIRTABLE_BASE_ID ili CATHEDRA_AIRTABLE_API_KEY nije postavljen — /api/cathedra/* endpointi neće raditi');
}
const cathedraAirtable = (CATHEDRA_BASE_ID && CATHEDRA_API_KEY)
  ? new Airtable({ apiKey: CATHEDRA_API_KEY })
  : null;
const cathedraBase = cathedraAirtable ? cathedraAirtable.base(CATHEDRA_BASE_ID) : null;

// ── Table ID-jevi ─────────────────────────────────────────────────────────────
const CAT_TABLE_UPISI = 'tblWEFFvDyvZqtsej'; // UPISI
const CAT_TABLE_EP    = 'tblcOhQOfPSWmEmPj'; // EVIDENCIJA PREDMETA
const CAT_TABLE_PI    = 'tblVk6NRhF7ejohC8'; // PRIJAVE ISPITA

// ── UPISI field imena ─────────────────────────────────────────────────────────
const UPISI_PWA_TOKEN = 'PWA Token';           // singleLineText
const UPISI_ZAVRSENO  = 'Završeno';            // checkbox
const UPISI_EP_LINK   = 'EVIDENCIJA PREDMETA'; // multipleRecordLinks

// ── UPISI — dashboard polja ───────────────────────────────────────────────────
const UPISI_POLAZNIK_FORMULA = 'Upisi (ID)';    // formula → ARRAYJOIN(POLAZNICI) → ime
const UPISI_SMJER_TXT        = 'Smjer_txt';     // formula → tekst smjera
const UPISI_SKUPINA_LINK     = 'Grupa';         // multipleRecordLinks → GRUPE
const UPISI_GODINA_LINK      = 'Godina';        // multipleRecordLinks → GODINE

// ── Dodatne tablice za student dashboard ─────────────────────────────────────
const CAT_TABLE_GRUPE  = 'tblUpPK0ITMx9WDmG'; // GRUPE
const CAT_TABLE_GODINE = 'tblLk7uqZWEzadLHP';  // GODINE

// ── EVIDENCIJA PREDMETA field imena ──────────────────────────────────────────
const EP_PREDMET_ZAPIS = 'Predmet zapis';   // primary, singleLineText
const EP_UPIS_LINK     = 'Upis';            // multipleRecordLinks
const EP_NAZIV         = 'Naziv predmeta';  // multipleLookupValues
const EP_RAZRED        = 'Razred_predmeta'; // multipleLookupValues
const EP_STATUS_PRED   = 'Status predmeta'; // singleSelect
const EP_POLOZIO       = 'Položio';         // checkbox

// ── PRIJAVE ISPITA field imena ────────────────────────────────────────────────
const PI_EP_LINK   = 'EVIDENCIJA PREDMETA'; // multipleRecordLinks
const PI_UPIS_LINK = 'UPIS';                // multipleRecordLinks
const PI_STATUS    = 'Status prijave';       // singleSelect
const PI_IZVOR     = 'Izvor prijave';        // singleSelect
const PI_PWA_TOKEN = 'PWA Token';            // singleLineText

// Statusi koji znače da prijava još nije zatvorena/poništena
const CATHEDRA_ACTIVE_STATUSES = new Set(['Nova prijava', 'U obradi', 'Prijavljeno']);

// ── CATHEDRA Airtable helperi ─────────────────────────────────────────────────

function cathedraGuard(res) {
  if (!cathedraBase) {
    res.status(503).json({ ok: false, error: 'CATHEDRA_NOT_CONFIGURED', message: 'Cathedra modul nije konfiguriran.' });
    return false;
  }
  return true;
}

async function cathedraSelectAll(tableId, options = {}) {
  const records = [];
  const safe = { ...options };
  safe.pageSize = clampPageSize(safe.pageSize ?? 50);
  await cathedraBase(tableId).select(safe).eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  return records;
}

async function cathedraSelectFirst(tableId, options = {}) {
  const safe = { ...options };
  safe.pageSize = 1;
  safe.maxRecords = 1;
  const recs = await cathedraSelectAll(tableId, safe);
  return recs[0] || null;
}

async function cathedraFindByIds(tableId, ids = []) {
  const uniq = Array.from(new Set(asArray(ids).map(String).filter(Boolean)));
  if (!uniq.length) return [];
  const out = await Promise.allSettled(
    uniq.map(id => cathedraBase(tableId).find(id))
  );
  return out.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value);
}

// ── GET /api/cathedra/subjects?token=... ──────────────────────────────────────
// Vraća popis predmeta za UPIS koji odgovara danom PWA tokenu.
// Za svaki predmet vraća mogu li ga prijaviti i zašto ne ako ne mogu.

app.get('/api/cathedra/subjects', async (req, res) => {
  if (!cathedraGuard(res)) return;
  try {
    const { token } = req.query;

    // 1. Token mora biti prisutan
    if (!token || !String(token).trim()) {
      return res.status(400).json({ ok: false, error: 'MISSING_TOKEN', message: 'Token je obavezan.' });
    }

    // 2. Nađi UPIS po PWA Tokenu — dohvaćamo i dashboard polja
    const upis = await cathedraSelectFirst(CAT_TABLE_UPISI, {
      filterByFormula: `{${UPISI_PWA_TOKEN}} = '${escapeAirtableFormulaString(token)}'`,
      fields: [
        UPISI_PWA_TOKEN, UPISI_ZAVRSENO, UPISI_EP_LINK,
        UPISI_POLAZNIK_FORMULA, UPISI_SMJER_TXT,
        UPISI_SKUPINA_LINK, UPISI_GODINA_LINK,
      ],
    });

    if (!upis) {
      return res.status(403).json({ ok: false, error: 'TOKEN_INVALID', message: 'Nevažeći token.' });
    }

    // 3. Izvuci osnovne podatke iz UPIS zapisa
    const epIds      = asArray(upis.fields[UPISI_EP_LINK]);
    const upisId     = upis.id;
    const locked     = upis.fields[UPISI_ZAVRSENO] === true;
    const skupinaIds = asArray(upis.fields[UPISI_SKUPINA_LINK])
                         .filter(id => typeof id === 'string' && id.startsWith('rec'));
    const godinaIds  = asArray(upis.fields[UPISI_GODINA_LINK])
                         .filter(id => typeof id === 'string' && id.startsWith('rec'));

    // 4. Paralelno: EP zapisi + skupnja + godina (sve odjednom)
    const [epRecords, skupinaRec, godinaRec] = await Promise.all([
      epIds.length
        ? cathedraFindByIds(CAT_TABLE_EP, epIds)
        : Promise.resolve([]),
      skupinaIds[0]
        ? cathedraBase(CAT_TABLE_GRUPE).find(skupinaIds[0]).catch(() => null)
        : Promise.resolve(null),
      godinaIds[0]
        ? cathedraBase(CAT_TABLE_GODINE).find(godinaIds[0]).catch(() => null)
        : Promise.resolve(null),
    ]);

    // 5. Gradi student objekt za dashboard
    const student = {
      name:     upis.fields[UPISI_POLAZNIK_FORMULA] || '',
      smjer:    upis.fields[UPISI_SMJER_TXT]        || '',
      godina:   godinaRec?.fields?.['Školska godina'] ?? '',
      grupa:    skupinaRec?.fields?.['Naziv grupe']
                  ?? skupinaRec?.fields?.['Grupa']
                  ?? '',
      zavrseno: locked,
    };

    // 6. Rano vraćanje ako nema predmeta
    if (!epIds.length) {
      return res.json({
        ok: true,
        ...(locked ? { locked: true, message: 'Vaš program je završen. Prijava ispita više nije dostupna.' } : {}),
        student,
        studentName: student.name,
        stats: { total: 0, canRegister: 0, activeRegistrations: 0, passed: 0, recognized: 0 },
        subjects: [],
      });
    }

    // 7. Dohvati sve PRIJAVE ISPITA za ovaj UPIS odjednom (jedan API poziv)
    const piRecords = locked ? [] : await cathedraSelectAll(CAT_TABLE_PI, {
      filterByFormula: `{${PI_PWA_TOKEN}} = '${escapeAirtableFormulaString(token)}'`,
      fields: [PI_EP_LINK, PI_STATUS],
      pageSize: 100,
    });

    // Indeks aktivnih prijava po EP record ID-u
    const activePrijaveByEpId = new Map();
    for (const pi of piRecords) {
      const status = pi.fields[PI_STATUS] || '';
      if (!CATHEDRA_ACTIVE_STATUSES.has(status)) continue;
      for (const epId of asArray(pi.fields[PI_EP_LINK])) {
        activePrijaveByEpId.set(epId, true);
      }
    }

    // 8. Gradi subjects
    const subjects = epRecords.map(ep => {
      const f = ep.fields;
      const naziv  = asArray(f[EP_NAZIV])[0]  || f[EP_PREDMET_ZAPIS] || '';
      const razred = asArray(f[EP_RAZRED])[0] || '';
      const statusPred        = f[EP_STATUS_PRED] || '';
      const polozio           = f[EP_POLOZIO] === true;
      const imaAktivnuPrijavu = activePrijaveByEpId.has(ep.id);

      let mozePrijaviti = true;
      let razlog = null;

      if (locked) {
        mozePrijaviti = false;
        razlog = 'Vaš program je završen.';
      } else if (statusPred === 'PRIZNAJE SE') {
        mozePrijaviti = false;
        razlog = 'Predmet je priznat — ne prijavljuje se za ispit.';
      } else if (polozio) {
        mozePrijaviti = false;
        razlog = 'Predmet je već položen.';
      } else if (imaAktivnuPrijavu) {
        mozePrijaviti = false;
        razlog = 'Već imate aktivnu prijavu za ovaj predmet.';
      }

      return {
        evidencijaPredmetaId: ep.id,
        naziv,
        razred,
        statusPredmeta: statusPred,
        polozio,
        imaAktivnuPrijavu,
        mozePrijaviti,
        ...(razlog ? { razlog } : {}),
      };
    });

    // 9. Statistike
    const stats = {
      total:               subjects.length,
      canRegister:         subjects.filter(s => s.mozePrijaviti).length,
      activeRegistrations: subjects.filter(s => s.imaAktivnuPrijavu).length,
      passed:              subjects.filter(s => s.polozio).length,
      recognized:          subjects.filter(s => s.statusPredmeta === 'PRIZNAJE SE').length,
    };

    console.log(`[cathedra] subjects OK — upis=${upisId} locked=${locked} predmeta=${subjects.length}`);
    return res.json({
      ok: true,
      ...(locked ? { locked: true, message: 'Vaš program je završen. Prijava ispita više nije dostupna.' } : {}),
      student,
      studentName: student.name,   // backward compat
      stats,
      subjects,
    });

  } catch (e) {
    console.error('[cathedra] subjects error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Interna greška servera.' });
  }
});

// ── POST /api/cathedra/exam-registration ──────────────────────────────────────
// Kreira zapis u PRIJAVE ISPITA nakon 7 sigurnosnih provjera.
// Payload: { token, evidencijaPredmetaId }

app.post('/api/cathedra/exam-registration', async (req, res) => {
  if (!cathedraGuard(res)) return;
  try {
    const { token, evidencijaPredmetaId } = req.body || {};

    // 1. Provjera obaveznih parametara
    if (!token || !String(token).trim()) {
      return res.status(400).json({ ok: false, error: 'MISSING_TOKEN', message: 'Token je obavezan.' });
    }
    if (!evidencijaPredmetaId || !String(evidencijaPredmetaId).startsWith('rec')) {
      return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT', message: 'ID predmeta je obavezan.' });
    }

    // 2. Nađi UPIS po PWA Tokenu
    const upis = await cathedraSelectFirst(CAT_TABLE_UPISI, {
      filterByFormula: `{${UPISI_PWA_TOKEN}} = '${escapeAirtableFormulaString(token)}'`,
      fields: [UPISI_PWA_TOKEN, UPISI_ZAVRSENO, UPISI_EP_LINK],
    });

    if (!upis) {
      return res.status(401).json({ ok: false, error: 'TOKEN_INVALID', message: 'Nevažeći token.' });
    }

    // 3. Provjera završenosti programa
    if (upis.fields[UPISI_ZAVRSENO] === true) {
      return res.status(403).json({
        ok: false,
        error: 'PROGRAM_COMPLETED',
        message: 'Vaš program je završen. Prijava ispita više nije dostupna.',
      });
    }

    // 4. Dohvati EP zapis (direktno po ID-u)
    let epRecord = null;
    try {
      epRecord = await cathedraBase(CAT_TABLE_EP).find(evidencijaPredmetaId);
    } catch (_) {
      epRecord = null;
    }
    if (!epRecord) {
      return res.status(404).json({ ok: false, error: 'SUBJECT_NOT_FOUND', message: 'Predmet nije pronađen.' });
    }

    // 5. Provjera da EP pripada ovom UPISU
    //    Koristimo listu EP ID-ova iz UPIS zapisa (brže od cross-querying)
    const upisEpIds = asArray(upis.fields[UPISI_EP_LINK]);
    if (!upisEpIds.includes(evidencijaPredmetaId)) {
      return res.status(403).json({ ok: false, error: 'SUBJECT_NOT_ALLOWED', message: 'Ovaj predmet ne pripada vašem upisu.' });
    }

    // 6. Provjera Status predmeta — PRIZNAJE SE ne može se prijaviti
    const statusPred = epRecord.fields[EP_STATUS_PRED] || '';
    if (statusPred === 'PRIZNAJE SE') {
      return res.status(400).json({
        ok: false,
        error: 'SUBJECT_RECOGNIZED',
        message: 'Ovaj predmet vam je priznat i ne prijavljuje se za ispit.',
      });
    }

    // 7. Provjera je li predmet već položen
    if (epRecord.fields[EP_POLOZIO] === true) {
      return res.status(400).json({
        ok: false,
        error: 'SUBJECT_ALREADY_PASSED',
        message: 'Ovaj predmet je već evidentiran kao položen.',
      });
    }

    // 8. Provjera aktivne duplikatne prijave
    //    Dohvati sve aktivne PI za ovaj token, zatim provjeri EP u JS-u
    const activePiForUpis = await cathedraSelectAll(CAT_TABLE_PI, {
      filterByFormula: `AND(
        {${PI_PWA_TOKEN}} = '${escapeAirtableFormulaString(token)}',
        OR(
          {${PI_STATUS}} = 'Nova prijava',
          {${PI_STATUS}} = 'U obradi',
          {${PI_STATUS}} = 'Prijavljeno'
        )
      )`,
      fields: [PI_STATUS, PI_EP_LINK],
      pageSize: 100,
    });
    const existingActive = activePiForUpis.find(pi =>
      asArray(pi.fields[PI_EP_LINK]).includes(evidencijaPredmetaId)
    );

    if (existingActive) {
      return res.status(409).json({
        ok: false,
        error: 'ACTIVE_REGISTRATION_EXISTS',
        message: 'Već imate aktivnu prijavu za ovaj predmet. Za izmjenu se obratite recepciji.',
      });
    }

    // 9. Sve provjere prošle — kreiraj PRIJAVE ISPITA zapis
    const created = await cathedraBase(CAT_TABLE_PI).create({
      [PI_UPIS_LINK]: [upis.id],
      [PI_EP_LINK]:   [evidencijaPredmetaId],
      [PI_STATUS]:    'Nova prijava',
      [PI_IZVOR]:     'PWA',
      [PI_PWA_TOKEN]: String(token),
    });

    console.log(`[cathedra] exam-registration OK — prijavaId=${created.id} upis=${upis.id} ep=${evidencijaPredmetaId}`);
    return res.json({
      ok: true,
      prijavaId: created.id,
      status: 'Nova prijava',
      message: 'Vaša prijava ispita je zaprimljena.',
    });

  } catch (e) {
    console.error('[cathedra] exam-registration error:', e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Interna greška servera.' });
  }
});

app.listen(PORT, async () => {
  console.log(`✅ AI Olly HUB WEB server running on :${PORT} (build=${BUILD})`);
  await loadPushSubscriptionsFromAirtable();
});

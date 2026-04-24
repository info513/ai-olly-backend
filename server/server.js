// server.js — AI OLLY HUB
// Endpoints: /api/health, /api/debug, /api/web-ask,
//            /api/pwa-ask, /api/pwa-request, /api/pwa-welcome,
//            /api/pwa-room-guide, /api/pwa-services, /api/pwa-pois, /api/pwa-routes
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Airtable from 'airtable';
import OpenAI from 'openai';
import { normalizeText, detectLang, isContactCoreQuestion, isBreakfastHoursQuestion, isHousekeepingHoursQuestion, isWifiQuestion, isPetPolicyQuestion, isHotelSpecificQuestion, isCityQuestion, isAcQuestion, isTvQuestion, isSafeQuestion, isCityActivityQuestion, isCheckinTimeOnlyQuestion, isEmergencyQuestion, isParkingAvailabilityQuery, isWhatsAppQuestion } from './classify.js';
import { timingSafeEqual } from 'node:crypto';
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

  // CORS
  CORS_ORIGINS = '',
} = process.env;

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
const allowedOrigins = String(CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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

app.use(express.json({ limit: '1mb' }));
app.use('/pwa', express.static('pwa'));

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
      f.telefon
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

// Fetch ALL rooms for a hotel without any AI_SOURCE filter — for room type lookup
async function getRoomsRaw(hotelSlug) {
  const cacheKey = 'raw:' + hotelSlug;
  const cached   = CACHE.roomsByHotel.get(cacheKey);
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);
  const recs    = await airtableSelectAllSafe(TABLE_ROOMS, [
    { pageSize: 100, filterByFormula: `{Hotel Slug (text)}='${slugEsc}'` },
    { pageSize: 100, filterByFormula: `{Hotel Slug}='${slugEsc}'`        },
  ]);

  const rows = recs.map(mapRoomRecord);
  if (rows.length > 0) CACHE.roomsByHotel.set(cacheKey, { ts: Date.now(), rows });
  return rows;
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
      ? `Yes, you can contact us on WhatsApp: ${url}`
      : `Da, možete nas kontaktirati putem WhatsAppa: ${url}`;
  }

  // Priority 2: wa.me URL embedded in any active service record Opis
  for (const r of (services || [])) {
    const match = (r.opis || '').match(/https?:\/\/wa\.me\/\S+/);
    if (match) {
      return lang === 'EN'
        ? `Yes, you can contact us on WhatsApp: ${match[0]}`
        : `Da, možete nas kontaktirati putem WhatsAppa: ${match[0]}`;
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
// Returns reception phone + Croatian emergency numbers (112, 194) immediately.
// Avoids routing medical or fire queries through hotel-card dump or GPT.
function renderEmergencyAnswer(hotelRec, lang = 'HR', question = '') {
  const phone = hotelRec?.telefon;
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
      ? `If there is a fire or immediate danger, stay calm and leave the building immediately using the nearest safe exit. Follow any instructions from hotel staff.${phoneLine} Call 112 for all emergencies, or 194 for ambulance assistance. Contact Reception for guidance if it is safe to do so.`
      : `U slučaju požara ili neposredne opasnosti, ostanite mirni i napustite zgradu odmah koristeći najbliži siguran izlaz. Slijedite upute hotelskog osoblja.${phoneLine} Nazovite 112 za sve hitne slučajeve, ili 194 za hitnu medicinsku pomoć. Ako je sigurno, kontaktirajte recepciju za smjernice.`;
  }

  return lang === 'EN'
    ? `Please contact Reception immediately for urgent assistance.${phoneLine} For medical emergencies call 194 (ambulance). For all emergencies call 112.`
    : `Molimo odmah kontaktirajte recepciju za hitnu pomoć.${phoneLine} Za hitnu medicinsku pomoć nazovite 194. Za sve hitne slučajeve nazovite 112.`;
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
  const personaBlock = hotelRec?.personaVoice
    ? `PERSONA:\n${hotelRec.personaVoice}\n\n`
    : '';

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
- Answer hotel-specific facts ONLY using HOTEL CORE, ROOM CONTEXT, or SERVICE RECORDS provided.
- If a detail is not in the provided data, say it is not available and suggest contacting reception.
- Do NOT guess prices, policies, times, services, room features, phone numbers, or procedures.
- You CAN help with in-room topics (AC, TV, safe, WiFi) using the ROOM CONTEXT data.
- For real problems or emergencies, always direct the guest to call reception.
- Never open an answer with a greeting ("Welcome", "Hello", "Good morning", "Dobrodošli", etc.) unless the guest's own message was itself a greeting.
- Never end an answer with a filler sign-off ("If you need anything, let me know", "Feel free to contact us", "I hope that helps", etc.). Stop after the last meaningful sentence.
- Never output a price unless it appears verbatim in the provided data.
- When a guest asks about nearby attractions, sightseeing, or local activities, reference the City Map or Routes sections in their guide app.

OUTPUT FORMAT:
- Write in 2–4 natural flowing prose sentences. Do NOT use bullet points (•, -, *) or numbered lists unless the guest explicitly asks "list" or "what are all".
- If room notes contain raw shorthand, internal abbreviations, or non-English phrases, rephrase them clearly in the answer language — do not copy them verbatim.
- For room feature questions, describe the room naturally as a short paragraph, not a feature inventory.

${personaBlock}${styleText}

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
  // Persona voice: hotel-specific character injected before output rules.
  // Empty string when field is not yet populated — no effect on prompt.
  const personaBlock = hotelRec?.personaVoice
    ? `PERSONA:\n${hotelRec.personaVoice}\n\n`
    : '';

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
- You MUST answer hotel-specific facts ONLY using HOTEL CORE or RECORDS provided.
- If a detail is not present there, you MUST say it's not available and suggest contacting reception.
- You MUST NOT guess prices, policies, times, services, amenities, room features, phone numbers, addresses, or procedures.
- This is WEB (website visitor). Do NOT handle in-room complaints or troubleshooting flows; if user reports an in-room issue, direct them to reception.
- Do NOT repeat greetings unless the user greets first.
- Keep answers short (1–4 sentences) unless user asks for details.
- If user asks to LIST things (amenities, beds, views, room types), you MUST output a clean bullet list. Do NOT describe in prose.
- If multiple items match (e.g., multiple rooms with a view), list ALL relevant items you have in RECORDS.
- Never output a price unless it exists verbatim in HOTEL CORE or RECORDS.

${personaBlock}${styleText}

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

app.post('/api/web-ask', async (req, res) => {
  const started = Date.now();

  try {
    const question = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const hotelSlug = pickFirstNonEmpty(req.query?.slug, req.body?.slug, HOTEL_SLUG_DEFAULT);
    const lang = detectLang(question);

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

    // ✅ 0) Deterministički: HOTEL core (kontakt / maps / check-in-out)
    if (isContactCoreQuestion(question)) {
      const answer = renderHotelCoreAnswer(hotelRec, lang);
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

    // ✅ 0.9) Deterministički: WhatsApp contact
    // Hard guard — fires before intent routing; returns WA link directly.
    // Prevents GPT from hallucinating “we don't have WhatsApp” when no WA
    // data was in the linked service record's Opis.
    if (isWhatsAppQuestion(question)) {
      const answer = renderWhatsAppAnswer(hotelRec, services, lang);
      const ms = Date.now() - started;
      return res.json({
        ok: true,
        answer,
        meta: {
          hotelSlug,
          deterministic: 'whatsapp',
          ms,
        },
      });
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

    // ✅ 0) Deterministic: hotel core (contact / address / check-in-out)
    if (isContactCoreQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderHotelCoreAnswer(hotelRec, lang),
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

    // ✅ 0.9) Deterministic: WhatsApp contact — same guard as web-ask
    if (isWhatsAppQuestion(question)) {
      return res.json({
        ok: true,
        answer: renderWhatsAppAnswer(hotelRec, pwaServices, lang),
        meta: { hotelSlug, roomNumber, deterministic: 'whatsapp', ms: Date.now() - started },
      });
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
    const category   = pickFirstNonEmpty(req.body?.category, '');
    const message    = pickFirstNonEmpty(req.body?.message, '');
    const guestName  = pickFirstNonEmpty(req.body?.guestName, req.body?.guest_name, '');
    const priority   = pickFirstNonEmpty(req.body?.priority, 'Normal');

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
    if (guestName) fields['Gost - ime'] = guestName;
    if (priority)  fields['Prioritet']  = priority;

    const created = await base(TABLE_REQUESTS).create(fields);

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

    // Room type — fetch all rooms for hotel (no AI_SOURCE filter), find by number in JS
    let roomType = '';
    try {
      const allRoomsRaw = await getRoomsRaw(hotelSlug);
      const roomRec     = allRoomsRaw.find(r =>
        String(r.naziv || '').trim() === String(roomNumber).trim()
      );
      roomType = roomRec?.tipSobe || '';
    } catch (_) { /* silent — room type is optional */ }

    return res.json({
      ok:        true,
      hotelName: hotelRec?.hotelNaziv ?? '',
      roomType,
      aiWelcome: roomGuide?.aiWelcome ?? '',
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

app.listen(PORT, () => {
  console.log(`✅ AI Olly HUB WEB server running on :${PORT} (build=${BUILD})`);
});

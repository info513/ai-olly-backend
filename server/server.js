// server.js — AI OLLY HUB (WEB widget only)
// Endpoints: /api/health, /api/debug, /api/web-ask
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Airtable from 'airtable';
import OpenAI from 'openai';

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

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function isEmptyArray(v) {
  return Array.isArray(v) && v.length === 0;
}

function fieldHasAny(fieldsValue, allowed) {
  const arr = asArray(fieldsValue).map(String);
  const allowedSet = new Set(allowed.map(String));
  return arr.some(v => allowedSet.has(v));
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

// ✅ “siguran select”: prvo pokušaj s filterByFormula, ako puca ili vrati 0 — uzmi sve
async function airtableSelectAllSafe(tableName, tryOptions = [], fallbackOptions = {}) {
  for (const opt of tryOptions) {
    try {
      const recs = await airtableSelectAll(tableName, opt);
      if (Array.isArray(recs) && recs.length) return recs;
    } catch (e) {
      // ignore and try next
    }
  }
  return airtableSelectAll(tableName, fallbackOptions);
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(s) {
  const t = normalizeText(s);
  if (!t) return [];
  return t.split(/\s+/).filter(Boolean);
}

// ✅ bolja detekcija jezika (HR vs EN)
function detectLang(question) {
  const q = String(question || '');
  const ql = q.toLowerCase();
  const hasCroChars = /[čćžšđ]/i.test(q);
  const hasHrWords = /\b(je|li|imate|gdje|kada|radno|vrijeme|soba|sobe|doručak|recepcija|parking|adresa|broj|pravila|kućni|molim|hvala|trebam)\b/i.test(ql);
  return (hasCroChars || hasHrWords) ? 'HR' : 'EN';
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

// ✅ kontakt / telefon / email / maps / check-in-out (deterministički)
function isContactCoreQuestion(question) {
  const q = normalizeText(question);
  return (
    q.includes('contact') ||
    q.includes('kontakt') ||
    q.includes('phone') ||
    q.includes('telefon') ||
    q.includes('tel') ||
    q.includes('call') ||
    q.includes('email') ||
    q.includes('e mail') ||
    q.includes('reach') ||
    q.includes('reception') ||
    q.includes('recepc') ||
    q.includes('address') ||
    q.includes('adresa') ||
    q.includes('google maps') ||
    q.includes('maps') ||
    q.includes('instagram') ||
    q.includes('review') ||
    q.includes('check in') ||
    q.includes('checkin') ||
    q.includes('check out') ||
    q.includes('checkout') ||
    q.includes('arrival time') ||
    q.includes('departure time')
  );
}

// ✅ hotel-specific heuristika (da možemo hard-stop kad nema podataka)
function isHotelSpecificQuestion(question) {
  const q = normalizeText(question);
  const keys = [
    'recepcija','reception','wifi','wi fi','internet','parking','parkiranje','doručak','breakfast',
    'mini bar','minibar','check in','check-out','checkout','checkin','policy','pravila','pet','dog',
    'laundry','dry cleaning','cleaning','housekeeping','room','rooms','soba','sobe','bed','krevet',
    'view','pogled','floor','kat','size','kvadratura','capacity','kapacitet',
    'amenities','oprema','sadržaj',
    'transfer','airport','zračna luka','zracna luka','taxi','uber','directions','how to get','dolazak',
    'invoice','račun','r1','city tax','tourist tax','boravišna','boravisna'
  ];
  return keys.some(k => q.includes(k));
}

function isCityQuestion(question) {
  const q = normalizeText(question);
  return q.includes('split') || q.includes('dioklecijan') || q.includes('palač') || q.includes('palace') || q.includes('peristil');
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

    active: (f.Active ?? true) === true,
  } : null;

  const finalRow = (row && row.active) ? row : null;

  CACHE.hotelBySlug.set(String(hotelSlug), { ts: Date.now(), row: finalRow });
  return finalRow;
}

function valuesToStrings(v) {
  return asArray(v).map(x => String(x).trim()).filter(Boolean);
}

function matchesHotelSlug(fieldValue, hotelSlug) {
  const target = String(hotelSlug || '').trim();
  const vals = valuesToStrings(fieldValue);
  return vals.some(x => x === target);
}

// ✅ WEB filter: ako je AI_SOURCE prazan -> prihvati
function allowForWeb(aiSourceArr) {
  const src = asArray(aiSourceArr);
  return isEmptyArray(src) || fieldHasAny(src, ['WEB']);
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
    aiPrompt: pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt),
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
    naziv: pickFirstNonEmpty(f['Soba oznaka'], f.Naziv, f.Name),
    tipSobe: pickFirstNonEmpty(f['Tip sobe'], f.Tip, f.tip),
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
    ],
    { pageSize: 100 }
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
    ],
    { pageSize: 100 }
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

// -------------------------
// GPT answer generation (STRICT)
// -------------------------
async function generateAnswer({ question, hotelSlug, lang, hotelRec, intentPick, recordsToUse, outputRule }) {
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
        (!valuesToStrings(r.hotelSlugRaw).length || matchesHotelSlug(r.hotelSlugRaw, hotelSlug))
      );

      const linkedRooms = roomRecs.map(mapRoomRecord).filter(r =>
        r.active &&
        allowForWeb(r.aiSource) &&
        (!valuesToStrings(r.hotelSlugRaw).length || matchesHotelSlug(r.hotelSlugRaw, hotelSlug))
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
    if (isHotelSpecificQuestion(question) && !recordsToUse.length && !hotelRec && !isCityQuestion(question)) {
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

app.listen(PORT, () => {
  console.log(`✅ AI Olly HUB WEB server running on :${PORT} (build=${BUILD})`);
});

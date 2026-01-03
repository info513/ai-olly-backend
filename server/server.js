// server.js — AI OLLY HUB (WEB widget only)
// Endpoints: /api/health, /api/web-ask
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
  TABLE_HOTELS = 'HOTELI',
  TABLE_ROOMS = 'SOBE',
  TABLE_SERVICES = 'SERVICES',
  TABLE_INTENTS = 'AI_INTENT_PATTERNS',
  TABLE_OUTPUT_RULES = 'AI_OUTPUT_RULES',

  // CORS
  CORS_ORIGINS = '',
} = process.env;

if (!OPENAI_API_KEY || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error('❗ Missing env vars: OPENAI_API_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID');
  process.exit(1);
}

const app = express();

// -------------------------
// CORS (restrict to allowed origins)
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

// Treat missing AI_SOURCE as "allowed everywhere" (so you don't break older rows)
function aiSourceAllows(fieldsValue, wanted /* 'WEB' or 'PWA' */) {
  const arr = asArray(fieldsValue).map(String);
  if (!arr.length) return true; // IMPORTANT: empty = allowed
  return arr.includes(String(wanted));
}

function isActiveTrue(f) {
  // standard: Active checkbox
  if (typeof f?.Active === 'boolean') return f.Active === true;

  // legacy variants (keep compatibility)
  if (typeof f?.['Is Active'] === 'boolean') return f['Is Active'] === true;
  if (typeof f?.IsActive === 'boolean') return f.IsActive === true;
  if (typeof f?.['Is Active?'] === 'boolean') return f['Is Active?'] === true;

  // status single select like "Active"
  const status = pickFirstNonEmpty(f?.Status, f?.status);
  if (status) return String(status).toLowerCase() === 'active';

  // if nothing exists, default allow
  return true;
}

async function airtableSelectAll(tableName, options) {
  const records = [];
  await base(tableName).select(options).eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  return records;
}

// -------------------------
// Cache (simple in-memory) — single Render instance
// -------------------------
const CACHE_TTL_MS = 60 * 1000; // 60s
let CACHE = {
  intents: { ts: 0, data: [] },
  outputRules: { ts: 0, data: [] },
  hotels: { ts: 0, data: [] },
  roomsByHotel: new Map(),     // hotelSlug -> {ts, rows}
  servicesByHotel: new Map(),  // hotelSlug -> {ts, rows}
};

function cacheFresh(ts) {
  return (Date.now() - ts) < CACHE_TTL_MS;
}

// -------------------------
// Load AI_INTENT_PATTERNS (WEB)
// Optional: support Hotel Slug column (per-hotel overrides)
// -------------------------
async function getIntentPatternsForWeb(hotelSlug) {
  if (cacheFresh(CACHE.intents.ts) && CACHE.intents.data.length) {
    // If we support per-hotel patterns, still filter at runtime
    return CACHE.intents.data.filter(p => !p.hotelSlug || p.hotelSlug === String(hotelSlug));
  }

  const recs = await airtableSelectAll(TABLE_INTENTS, { pageSize: 100 });

  const patternsAll = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      intent: pickFirstNonEmpty(f.Intent, f.intent),
      phrases: pickFirstNonEmpty(f.Phrases, f.phrases),
      appliesTo: asArray(f['Applies to'] ?? f.AppliesTo ?? f.applies_to), // WEB/PWA (multi)
      outputScope: pickFirstNonEmpty(f['Output Scope'], f.OutputScope, f.output_scope),
      servicesLink: f['Services link'] ?? f.ServicesLink ?? f.services_link, // optional linked
      roomsLink: f['Rooms link'] ?? f.RoomsLink ?? f.rooms_link,             // optional linked
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug), // optional
      active: isActiveTrue(f),
    };
  }).filter(p => p.intent && p.active);

  // WEB widget: allow patterns whose Applies to contains WEB.
  // If Applies to is empty (legacy), treat as allowed.
  const filtered = patternsAll.filter(p => {
    const a = p.appliesTo.map(String);
    if (!a.length) return true;
    return a.includes('WEB');
  });

  CACHE.intents = { ts: Date.now(), data: filtered };
  return filtered.filter(p => !p.hotelSlug || p.hotelSlug === String(hotelSlug));
}

// -------------------------
// Load AI_OUTPUT_RULES (cached)
// Optional: support Hotel Slug column (per-hotel overrides)
// -------------------------
async function loadOutputRules() {
  if (cacheFresh(CACHE.outputRules.ts) && CACHE.outputRules.data.length) return CACHE.outputRules.data;

  const recs = await airtableSelectAll(TABLE_OUTPUT_RULES, { pageSize: 100 });

  const rules = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      refId: pickFirstNonEmpty(f['Ref ID'], f.RefID, f.ref_id),
      scope: pickFirstNonEmpty(f.Scope, f.scope), // General / Room Guide / City Guide / Requests
      format: pickFirstNonEmpty(f.Format, f.format),
      style: pickFirstNonEmpty(f.Style, f.style),
      example: pickFirstNonEmpty(f['Example Output'], f.ExampleOutput, f.example_output),
      priority: Number(f.Priority ?? f.priority ?? 0),
      active: isActiveTrue(f),
      aiSource: asArray(f.AI_SOURCE ?? f.ai_source), // WEB/PWA (multi)
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug), // optional
    };
  });

  CACHE.outputRules = { ts: Date.now(), data: rules };
  return rules;
}

async function getOutputRule({ scopeWanted = 'General', aiSourceWanted = 'WEB', hotelSlug = '' }) {
  const rulesAll = await loadOutputRules();
  const scopeNorm = String(scopeWanted || 'General').toLowerCase();

  const filtered = rulesAll
    .filter(r => r.active)
    .filter(r => String(r.scope || '').toLowerCase() === scopeNorm)
    .filter(r => aiSourceAllows(r.aiSource, aiSourceWanted))
    .filter(r => !r.hotelSlug || r.hotelSlug === String(hotelSlug));

  filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return filtered[0] || null;
}

// -------------------------
// Load HOTELI (cached)
// -------------------------
async function loadHotels() {
  if (cacheFresh(CACHE.hotels.ts) && CACHE.hotels.data.length) return CACHE.hotels.data;

  const recs = await airtableSelectAll(TABLE_HOTELS, { pageSize: 50 });

  const hotels = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      naziv: pickFirstNonEmpty(f['Hotel naziv'], f.Naziv, f.Name),
      slug: pickFirstNonEmpty(f.Slug, f.slug),
      active: isActiveTrue(f),
      opisKratki: pickFirstNonEmpty(f['Opis (kratki)'], f.Opis, f.opis),
      adresa: pickFirstNonEmpty(f.Adresa, f.Address),
      grad: pickFirstNonEmpty(f.Grad, f.City),
      telefon: pickFirstNonEmpty(f.Telefon, f.Phone),
      email: pickFirstNonEmpty(f.Email, f['E-mail'], f.Mail),
      mapsUrl: pickFirstNonEmpty(f['Google Maps'], f.Maps, f.MapsURL, f['Maps URL']),
      parking: pickFirstNonEmpty(f.Parking, f['Parking info']),
      checkin: pickFirstNonEmpty(f['Check-in'], f.Checkin),
      checkout: pickFirstNonEmpty(f['Check-out'], f.Checkout),
      aiSource: asArray(f.AI_SOURCE ?? f.ai_source), // if you add later, ok
    };
  }).filter(h => h.slug && h.active);

  CACHE.hotels = { ts: Date.now(), data: hotels };
  return hotels;
}

async function getHotelBySlug(hotelSlug) {
  const hotels = await loadHotels();
  return hotels.find(h => String(h.slug) === String(hotelSlug)) || null;
}

// -------------------------
// Load SOBE rows per hotel (cached) and filter for WEB
// -------------------------
async function getRoomsForHotelWeb(hotelSlug) {
  const cached = CACHE.roomsByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const recs = await airtableSelectAll(TABLE_ROOMS, { pageSize: 100 });

  const rows = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      sobaOznaka: pickFirstNonEmpty(f['Soba oznaka'], f.Soba, f.Name, f.Naziv),
      tipSobe: pickFirstNonEmpty(f['Tip sobe'], f.Tip, f.Type),
      slug: pickFirstNonEmpty(f.Slug, f.slug),
      opis: pickFirstNonEmpty(f['Opis sobe'], f.Opis, f.opis),
      aiPrompt: pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt),
      aiIntent: asArray(f.AI_INTENT ?? f.ai_intent),
      aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug),
      active: isActiveTrue(f),
    };
  });

  const byHotel = rows
    .filter(r => r.active)
    .filter(r => String(r.hotelSlug) === String(hotelSlug));

  const bySourceWeb = byHotel.filter(r => aiSourceAllows(r.aiSource, 'WEB'));

  CACHE.roomsByHotel.set(String(hotelSlug), { ts: Date.now(), rows: bySourceWeb });
  return bySourceWeb;
}

// -------------------------
// Load SERVICES rows per hotel (cached) and filter for WEB
// -------------------------
async function getServicesForHotelWeb(hotelSlug) {
  const cached = CACHE.servicesByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const recs = await airtableSelectAll(TABLE_SERVICES, { pageSize: 200 });

  const rows = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      naziv: pickFirstNonEmpty(f['Naziv usluge'], f.Naziv, f.Name, f.Title, f.naziv),
      kategorija: asArray(f.Kategorija ?? f.kategorija),
      opis: pickFirstNonEmpty(f.Opis, f.opis),
      radnoVrijeme: pickFirstNonEmpty(f['Radno vrijeme'], f.Radno, f.radno_vrijeme),
      aiPrompt: pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt),
      aiIntent: asArray(f.AI_INTENT ?? f.ai_intent),
      aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug),
      active: isActiveTrue(f),
    };
  });

  const byHotel = rows
    .filter(r => r.active)
    .filter(r => String(r.hotelSlug) === String(hotelSlug));

  const bySourceWeb = byHotel.filter(r => aiSourceAllows(r.aiSource, 'WEB'));

  CACHE.servicesByHotel.set(String(hotelSlug), { ts: Date.now(), rows: bySourceWeb });
  return bySourceWeb;
}

// -------------------------
// Intent router (GPT-assisted) from patterns list
// -------------------------
async function chooseIntent(question, patterns) {
  if (!patterns.length) return { intent: null, confidence: 0, note: 'no_patterns', outputScope: 'General' };

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

    return { intent, confidence, outputScope, note: parsed.note || '' };
  } catch (e) {
    console.error('chooseIntent error:', e);
    return { intent: null, confidence: 0, outputScope: 'General', note: 'intent_router_failed' };
  }
}

// -------------------------
// Fallback search across records (services + rooms + hotel)
// -------------------------
function scoreRecord(question, text) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return 0;
  const hay = normalizeText(text);
  let score = 0;
  for (const t of qTokens) {
    if (t.length < 3) continue;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

function pickFallbackRecords(question, candidates, limit = 3) {
  const scored = candidates.map(r => ({ r, score: r._score || 0 }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score > 0).slice(0, limit).map(x => x.r);
}

// -------------------------
// Fetch records for question/intent
// -------------------------
async function fetchRows({ hotelSlug, intent, question, patterns }) {
  const services = await getServicesForHotelWeb(hotelSlug);
  const rooms = await getRoomsForHotelWeb(hotelSlug);
  const hotel = await getHotelBySlug(hotelSlug);

  // Match by intent in SERVICES + SOBE
  const matchedServices = intent
    ? services.filter(r => r.aiIntent.map(String).includes(String(intent)))
    : [];

  const matchedRooms = intent
    ? rooms.filter(r => r.aiIntent.map(String).includes(String(intent)))
    : [];

  // Build candidates for fallback scoring
  const candidates = [];

  for (const s of services) {
    const text = [s.naziv, s.kategorija.join(' '), s.opis, s.radnoVrijeme, s.aiIntent.join(' ')].join(' ');
    candidates.push({ ...s, _table: 'SERVICES', _score: scoreRecord(question, text) });
  }

  for (const rm of rooms) {
    const text = [rm.sobaOznaka, rm.tipSobe, rm.slug, rm.opis, rm.aiIntent.join(' ')].join(' ');
    candidates.push({ ...rm, _table: 'SOBE', _score: scoreRecord(question, text) });
  }

  if (hotel) {
    const text = [hotel.naziv, hotel.slug, hotel.opisKratki, hotel.adresa, hotel.grad, hotel.telefon, hotel.email, hotel.mapsUrl, hotel.parking, hotel.checkin, hotel.checkout].join(' ');
    candidates.push({ ...hotel, _table: 'HOTELI', _score: scoreRecord(question, text) });
  }

  const matched = [...matchedServices.map(x => ({ ...x, _table: 'SERVICES' })), ...matchedRooms.map(x => ({ ...x, _table: 'SOBE' }))];

  const fallback = (!matched.length)
    ? pickFallbackRecords(question, candidates, 3)
    : [];

  return {
    hotel,
    matched,
    fallback,
    counts: {
      servicesWeb: services.length,
      roomsWeb: rooms.length,
      hotelFound: hotel ? 1 : 0,
      candidates: candidates.length,
    }
  };
}

// -------------------------
// Build answer using records + output rules
// -------------------------
function buildContextBlocks(records) {
  return records.map((r, idx) => {
    if (r._table === 'HOTELI') {
      return `# HOTEL RECORD ${idx + 1}
Naziv: ${r.naziv}
Slug: ${r.slug}
Adresa: ${r.adresa || '-'}
Grad: ${r.grad || '-'}
Telefon: ${r.telefon || '-'}
Email: ${r.email || '-'}
Google Maps: ${r.mapsUrl || '-'}
Parking: ${r.parking || '-'}
Check-in: ${r.checkin || '-'}
Check-out: ${r.checkout || '-'}
Opis: ${r.opisKratki || '-'}`;
    }

    if (r._table === 'SOBE') {
      const aiPromptShort = (r.aiPrompt || '').slice(0, 600);
      const opisShort = (r.opis || '').slice(0, 1200);
      return `# ROOM RECORD ${idx + 1}
Soba: ${r.sobaOznaka || '-'}
Tip: ${r.tipSobe || '-'}
Slug: ${r.slug || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
    }

    // SERVICES
    const aiPromptShort = (r.aiPrompt || '').slice(0, 600);
    const opisShort = (r.opis || '').slice(0, 1200);
    return `# SERVICE RECORD ${idx + 1}
Naziv: ${r.naziv || '-'}
Kategorija: ${(r.kategorija || []).join(', ') || '-'}
Radno vrijeme: ${r.radnoVrijeme || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
  });
}

function hardNoInfoMessage(question) {
  const q = String(question || '').toLowerCase();
  const isHr = /[čćđšž]|(^|\s)(gdje|koje|kada|koliko|adresa|telefon|broj|lokacija|parking|sobe|doručak|wifi)(\s|$)/.test(q);

  if (isHr) {
    return 'Nažalost, za to trenutno nemam potvrđenu informaciju u sustavu. Preporučujem da kontaktirate recepciju hotela za točne detalje.';
  }
  return "Sorry — I don't have verified information for that right now. Please contact the hotel's reception for the exact details.";
}

async function generateAnswer({ question, hotelSlug, intentPick, recordsToUse, outputRule }) {
  // HARD STOP: no records => no OpenAI call (prevents hallucinations)
  if (!recordsToUse || !recordsToUse.length) {
    return hardNoInfoMessage(question);
  }

  const styleText = outputRule
    ? `OUTPUT RULE (Scope=${outputRule.scope}, Format=${outputRule.format}):
STYLE: ${outputRule.style}
EXAMPLE: ${outputRule.example}` // used as guidance, but we override greeting rule below
    : 'OUTPUT RULE: none (use clear short paragraphs).';

  const contextBlocks = buildContextBlocks(recordsToUse);

  const sys = `You are a hotel web assistant for website visitors.

CRITICAL RULES:
- This is the WEB widget. Do NOT assume the user is a checked-in guest.
- HOTEL-SPECIFIC facts MUST come from provided RECORDS. If missing in RECORDS, say you don't have that info and suggest contacting reception.
- NEVER invent: address, phone, parking policy, prices, schedules, room features, availability.
- Do NOT start every answer with "Dobrodošli" or repetitive greetings. Use a greeting only if the user greets first (e.g., "hi").
- Keep answers short, helpful, and specific.
- If question is ambiguous, ask ONE short clarifying question.

${styleText}

Respond in the user's language (HR/EN) matching the question.`;

  const userPayload = {
    hotel_slug: hotelSlug,
    question,
    picked_intent: intentPick?.intent || null,
    confidence: intentPick?.confidence ?? null,
    records: contextBlocks,
  };

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });

  return resp.choices?.[0]?.message?.content?.trim() || hardNoInfoMessage(question);
}

// -------------------------
// Routes
// -------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ai-olly-hub-web',
    time: nowIso(),
  });
});

app.post('/api/web-ask', async (req, res) => {
  const started = Date.now();

  try {
    const question = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const hotelSlug = pickFirstNonEmpty(req.query?.slug, req.body?.slug, HOTEL_SLUG_DEFAULT);

    if (!question) return res.status(400).json({ ok: false, error: 'Missing question' });

    // 1) Load patterns (WEB)
    const patterns = await getIntentPatternsForWeb(hotelSlug);

    // 2) Pick intent
    const intentPick = await chooseIntent(question, patterns);

    // Determine scope from picked intent (fallback General)
    let scopeWanted = 'General';
    if (intentPick?.intent) {
      const p = patterns.find(x => String(x.intent) === String(intentPick.intent));
      scopeWanted = (p?.outputScope || intentPick.outputScope || 'General');
    } else {
      scopeWanted = (intentPick.outputScope || 'General');
    }

    // 3) Fetch records from SERVICES + SOBE + HOTELI
    const { hotel, matched, fallback, counts } = await fetchRows({
      hotelSlug,
      intent: intentPick.intent,
      question,
      patterns,
    });

    const recordsToUse = matched.length ? matched : fallback;

    // 4) Output rule (by scopeWanted, source WEB). If missing, fallback to General/WEB
    let outputRule = await getOutputRule({ scopeWanted, aiSourceWanted: 'WEB', hotelSlug });
    if (!outputRule && String(scopeWanted).toLowerCase() !== 'general') {
      outputRule = await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'WEB', hotelSlug });
    }

    // 5) Generate answer
    const answer = await generateAnswer({
      question,
      hotelSlug,
      intentPick,
      recordsToUse,
      outputRule,
    });

    const ms = Date.now() - started;

    res.json({
      ok: true,
      answer,
      meta: {
        hotelSlug,
        intent: intentPick.intent,
        confidence: intentPick.confidence ?? null,
        scopeWanted,
        usedRecords: recordsToUse.map(r => ({
          table: r._table || null,
          naziv: r.naziv || r.sobaOznaka || null,
          id: r.id,
        })),
        usedFallback: (!matched.length && fallback.length) ? true : false,
        counts,
        ms,
      },
    });
  } catch (e) {
    console.error('web-ask error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ AI Olly HUB WEB server running on :${PORT}`);
});

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

  // vrati samo uspješne
  return out
    .filter(x => x.status === 'fulfilled' && x.value)
    .map(x => x.value);
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
  const hasCroChars = /[čćžšđ]/i.test(q);
  const hasHrWords = /\b(je|li|imate|gdje|kada|radno|vrijeme|soba|sobe|doručak|recepcija|parking|adresa|broj|pravila|kućni)\b/i.test(q.toLowerCase());
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

// ✅ hotel-specific heuristika (da možemo hard-stop kad nema podataka)
function isHotelSpecificQuestion(question) {
  const q = normalizeText(question);
  const keys = [
    'recepcija','reception','wifi','wi fi','internet','parking','parkiranje','doručak','breakfast',
    'mini bar','minibar','check in','check-out','checkout','checkin','policy','pravila','pet','dog',
    'laundry','dry cleaning','cleaning','housekeeping','room','rooms','soba','sobe','bed','krevet',
    'view','pogled','floor','kat','size','kvadratura','capacity','kapacitet'
  ];
  return keys.some(k => q.includes(k));
}

function isCityQuestion(question) {
  const q = normalizeText(question);
  return q.includes('split') || q.includes('dioklecijan') || q.includes('palač') || q.includes('palace') || q.includes('peristil');
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

      // linked record IDs (Airtable već vraća array record ID-jeva)
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
  const row = rec ? {
    id: rec.id,
    hotelNaziv: pickFirstNonEmpty(f['Hotel naziv'], f.Naziv, f.Name),
    slug: pickFirstNonEmpty(f.Slug, f.slug),
    opis: pickFirstNonEmpty(f['Opis (kratki)'], f.Opis, f.opis),
    adresa: pickFirstNonEmpty(f.Adresa, f.adresa),
    telefon: pickFirstNonEmpty(f.Telefon, f.telefon),
    email: pickFirstNonEmpty(f.Email, f.email),
    web: pickFirstNonEmpty(f.Web, f.web),
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

    // ✅ nova “čista” polja
    kapacitet: f['Kapacitet (osoba)'] ?? f.Kapacitet ?? f.kapacitet ?? null,
    kvadratura: f.Kvadratura ?? f.kvadratura ?? null,
    kat: f.Kat ?? f.kat ?? null,
    pogled: f.Pogled ?? f.pogled ?? null,
    kreveti: asArray(f.Kreveti ?? f.kreveti),
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

  let recs = await airtableSelectAll(TABLE_SERVICES, {
    pageSize: 100,
    filterByFormula: `{Hotel Slug}='${slugEsc}'`,
  });

  // fallback: ako filter ne radi (lookup/array), uzmi sve pa filtriraj ručno
  if (!recs.length) {
    recs = await airtableSelectAll(TABLE_SERVICES, { pageSize: 100 });
  }

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

  let recs = await airtableSelectAll(TABLE_ROOMS, {
    pageSize: 100,
    filterByFormula: `{Hotel Slug}='${slugEsc}'`,
  });

  // fallback: ako filter ne radi (lookup/array), uzmi sve pa filtriraj ručno
  if (!recs.length) {
    recs = await airtableSelectAll(TABLE_ROOMS, { pageSize: 100 });
  }

  const rows = recs.map(mapRoomRecord);

  const webRows = rows.filter(r =>
    r.active &&
    matchesHotelSlug(r.hotelSlugRaw, hotelSlug) &&
    allowForWeb(r.aiSource)
  );

  CACHE.roomsByHotel.set(String(hotelSlug), { ts: Date.now(), rows: webRows });
  return webRows;
}

function pickFallbackRecords(question, allRecords, limit = 3) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return [];

  const scored = allRecords.map(r => {
    const hay = normalizeText([
      r.type,
      r.naziv,
      r.tipSobe,
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

    let score = 0;
    for (const t of qTokens) {
      if (t.length < 3) continue;
      if (hay.includes(t)) score += 1;
    }
    return { r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score > 0).slice(0, limit).map(x => x.r);
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
      const view = r.pogled ? ` — view: ${Array.isArray(r.pogled) ? r.pogled.join(', ') : String(r.pogled)}` : '';
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
Pogled: ${Array.isArray(r.pogled) ? r.pogled.join(', ') : (r.pogled ?? '-')}
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
- Do NOT repeat greetings (e.g., "Dobrodošli") unless user greets first.
- Keep answers short (1–4 sentences) unless user asks for details.
- If multiple items match (e.g., multiple rooms with a view), list ALL relevant items you have in RECORDS.

${styleText}

Language:
- If lang=HR respond in Croatian.
- If lang=EN respond in English.`;

  const userPayload = {
    lang,
    hotel_slug: hotelSlug,
    question,
    picked_intent: intentPick?.intent || null,
    confidence: intentPick?.confidence ?? null,
    hotel_core: hotelBlock,
    records: contextBlocks,
  };

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0, // ✅ manje “kreative”
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });

  return resp.choices?.[0]?.message?.content?.trim() || '';
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

    // 1) patterns + intent
    const patterns = await getIntentPatternsForWeb();
    const intentPick = await chooseIntent(question, patterns);

    // 2) load knowledge (cached filtered lists)
    const { hotelRec, services, rooms, matched, fallback, all } = await fetchKnowledgeRows({
      hotelSlug,
      intent: intentPick.intent,
      question,
    });

    // 3) "vrste soba" -> deterministički (bez GPT-a)
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
          totalWebRecordsForHotel: all.length,
          ms,
        },
      });
    }

    // 4) Ako intent postoji i pattern ima linked recorde -> koristi njih (PRIMARNO)
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
        // ako je hotel slug upisan, neka mora matchati; ako je prazno, pusti (da te ne blokira tijekom sređivanja)
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

    // 5) fallback na AI_INTENT tagging ako nema linked
    if (!recordsToUse.length) {
      recordsToUse = matched.length ? matched : fallback;
    }

    // 6) HARD STOP:
    // - ako je hotel-specific i nemamo ništa (core + records), NE PUŠTAMO GPT da izmišlja
    // - ali gradska pitanja (Split/Palace) mogu ići dalje
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

    // 7) scope + output rule
    let scopeWanted = 'General';
    if (intentPick?.intent) {
      const p = patterns.find(x => String(x.intent) === String(intentPick.intent));
      scopeWanted = (p?.outputScope || intentPick.outputScope || 'General');
    }

    let outputRule = await getOutputRule({ scopeWanted, aiSourceWanted: 'WEB' });
    if (!outputRule && String(scopeWanted).toLowerCase() !== 'general') {
      outputRule = await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'WEB' });
    }

    // 8) Generate answer (strict)
    const answer = await generateAnswer({
      question,
      hotelSlug,
      lang,
      hotelRec,
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
        usedRecords: recordsToUse.map(r => ({ type: r.type, naziv: r.naziv, id: r.id })),
        usedFallback: (!matched.length && fallback.length) ? true : false,
        usedLinked,
        totalWebRecordsForHotel: all.length,
        ms,
      },
    });
  } catch (e) {
    console.error('web-ask error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ AI Olly HUB WEB server running on :${PORT} (build=${BUILD})`);
});

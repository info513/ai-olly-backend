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

function fieldHasAny(fieldsValue, allowed) {
  const arr = asArray(fieldsValue).map(String);
  const allowedSet = new Set(allowed.map(String));
  return arr.some(v => allowedSet.has(v));
}

function isEmptyArray(v) {
  return Array.isArray(v) && v.length === 0;
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

function isRoomTypesQuestion(question) {
  const q = normalizeText(question);
  // HR
  if (q.includes('vrste soba')) return true;
  if (q.includes('tipovi soba')) return true;
  // EN
  if (q.includes('types of rooms')) return true;
  if (q.includes('room types')) return true;

  // fallback heuristika
  const hasRooms = q.includes('soba') || q.includes('rooms') || q.includes('room');
  const hasTypes = q.includes('vrste') || q.includes('tip') || q.includes('types') || q.includes('type');
  return hasRooms && hasTypes;
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

  const recs = await airtableSelectAll(TABLE_INTENTS, { pageSize: 50 });

  const patterns = recs.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      intent: pickFirstNonEmpty(f.Intent, f.intent),
      phrases: pickFirstNonEmpty(f.Phrases, f.phrases),
      appliesTo: asArray(f['Applies to'] ?? f.AppliesTo ?? f.applies_to),
      outputScope: pickFirstNonEmpty(f['Output Scope'], f.OutputScope, f.output_scope),
    };
  }).filter(p => p.intent);

  const filtered = patterns.filter(p => fieldHasAny(p.appliesTo, ['WEB']));

  CACHE.intents = { ts: Date.now(), data: filtered };
  return filtered;
}

// -------------------------
// AI_OUTPUT_RULES
// -------------------------
async function loadOutputRules() {
  if (!cacheFresh(CACHE.outputRules.ts) || !CACHE.outputRules.data.length) {
    const recs = await airtableSelectAll(TABLE_OUTPUT_RULES, { pageSize: 50 });

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
    .filter(r => fieldHasAny(r.aiSource, [aiSourceWanted]));

  filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return filtered[0] || null;
}

// -------------------------
// Intent router
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

  const rec = await airtableSelectFirst(TABLE_HOTELS, {
    pageSize: 1,
    maxRecords: 1,
    filterByFormula: `{Slug}='${slugEsc}'`,
  });

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
  } : null;

  CACHE.hotelBySlug.set(String(hotelSlug), { ts: Date.now(), row });
  return row;
}

// ✅ WEB filter: ako je AI_SOURCE prazan -> prihvati (tretiraj kao "svugdje")
function allowForWeb(aiSourceArr) {
  const src = asArray(aiSourceArr);
  return isEmptyArray(src) || fieldHasAny(src, ['WEB']);
}

async function getServicesForHotelWeb(hotelSlug) {
  const cached = CACHE.servicesByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  const recs = await airtableSelectAll(TABLE_SERVICES, {
    pageSize: 50,
    filterByFormula: `{Hotel Slug}='${slugEsc}'`,
  });

  const rows = recs.map(r => {
    const f = r.fields || {};
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
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug),
      active: (f.Active ?? true) === true,
    };
  });

  const webRows = rows.filter(r =>
    r.active &&
    String(r.hotelSlug) === String(hotelSlug) &&
    allowForWeb(r.aiSource)
  );

  CACHE.servicesByHotel.set(String(hotelSlug), { ts: Date.now(), rows: webRows });
  return webRows;
}

async function getRoomsForHotelWeb(hotelSlug) {
  const cached = CACHE.roomsByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const slugEsc = escapeAirtableFormulaString(hotelSlug);

  const recs = await airtableSelectAll(TABLE_ROOMS, {
    pageSize: 50,
    filterByFormula: `{Hotel Slug}='${slugEsc}'`,
  });

  const rows = recs.map(r => {
    const f = r.fields || {};
    return {
      type: 'ROOM',
      id: r.id,
      naziv: pickFirstNonEmpty(f['Soba oznaka'], f.Naziv, f.Name),
      tipSobe: pickFirstNonEmpty(f['Tip sobe'], f.Tip, f.tip),
      slug: pickFirstNonEmpty(f.Slug, f.slug),
      opis: pickFirstNonEmpty(f['Opis sobe'], f.Opis, f.opis),
      aiPrompt: pickFirstNonEmpty(f.AI_PROMPT, f.ai_prompt),
      aiIntent: asArray(f.AI_INTENT ?? f.ai_intent),
      aiSource: asArray(f.AI_SOURCE ?? f.ai_source),
      hotelSlug: pickFirstNonEmpty(f['Hotel Slug'], f.HotelSlug, f.hotel_slug),
      active: (f.Active ?? true) === true,
    };
  });

  const webRows = rows.filter(r =>
    r.active &&
    String(r.hotelSlug) === String(hotelSlug) &&
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

  return { hotelRec, matched, fallback, all, rooms };
}

// -------------------------
// Answer generation
// -------------------------
async function generateAnswer({ question, hotelSlug, hotelRec, intentPick, recordsToUse, outputRule }) {
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
Parking (if defined): ${hotelRec.parking || '-'}` : '# HOTEL CORE\n(no hotel record found)';

  const contextBlocks = recordsToUse.map((r, idx) => {
    const aiPromptShort = (r.aiPrompt || '').slice(0, 600);
    const opisShort = (r.opis || '').slice(0, 1400);

    if (r.type === 'ROOM') {
      return `# RECORD ${idx + 1} (ROOM)
Naziv: ${r.naziv || '-'}
Tip sobe: ${r.tipSobe || '-'}
Slug: ${r.slug || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
    }

    return `# RECORD ${idx + 1} (SERVICE)
Naziv: ${r.naziv || '-'}
Kategorija: ${(r.kategorija || []).join(', ')}
Radno vrijeme: ${r.radnoVrijeme || '-'}
Opis: ${opisShort || '-'}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
  });

  const sys = `You are "AI Olly" — a hotel web assistant for website visitors.

CRITICAL RULES:
- WEB widget (website visitors). Do NOT assume the user is checked-in.
- HOTEL facts MUST come from HOTEL CORE or RECORDS. If missing, say you don't have that info and suggest contacting reception.
- Do NOT repeat greetings like "Dobrodošli" in every answer. Only greet if the user greets first.
- Keep answers short and direct (1–4 sentences) unless user asks for details.
- If multiple interpretations, ask ONE short clarifying question.

${styleText}

Respond in user's language (HR/EN) matching the question.`;

  const userPayload = {
    hotel_slug: hotelSlug,
    question,
    picked_intent: intentPick?.intent || null,
    confidence: intentPick?.confidence ?? null,
    hotel_core: hotelBlock,
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

  return resp.choices?.[0]?.message?.content?.trim() || '';
}

// -------------------------
// Routes
// -------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ai-olly-hub-web', time: nowIso() });
});

app.post('/api/web-ask', async (req, res) => {
  const started = Date.now();

  try {
    const question = pickFirstNonEmpty(req.body?.question, req.body?.q);
    const hotelSlug = pickFirstNonEmpty(req.query?.slug, req.body?.slug, HOTEL_SLUG_DEFAULT);

    if (!question) return res.status(400).json({ ok: false, error: 'Missing question' });

    const patterns = await getIntentPatternsForWeb();
    const intentPick = await chooseIntent(question, patterns);

    let scopeWanted = 'General';
    if (intentPick?.intent) {
      const p = patterns.find(x => String(x.intent) === String(intentPick.intent));
      scopeWanted = (p?.outputScope || intentPick.outputScope || 'General');
    } else {
      scopeWanted = (intentPick.outputScope || 'General');
    }

    const { hotelRec, matched, fallback, all, rooms } = await fetchKnowledgeRows({
      hotelSlug,
      intent: intentPick.intent,
      question,
    });

    let recordsToUse = matched.length ? matched : fallback;

    // ✅ Ako je pitanje "vrste soba" -> vrati listu svih soba (WEB)
    if (isRoomTypesQuestion(question) && Array.isArray(rooms) && rooms.length) {
      recordsToUse = rooms.slice(0, 20);
      scopeWanted = 'General';
    }

    let outputRule = await getOutputRule({ scopeWanted, aiSourceWanted: 'WEB' });
    if (!outputRule && String(scopeWanted).toLowerCase() !== 'general') {
      outputRule = await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'WEB' });
    }

    const answer = await generateAnswer({
      question,
      hotelSlug,
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
  console.log(`✅ AI Olly HUB WEB server running on :${PORT}`);
});

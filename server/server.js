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
    // allow server-to-server or curl without origin
    if (!origin) return cb(null, true);

    // if not set, allow all (fallback)
    if (!allowedOrigins.length) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS_BLOCKED:${origin}`));
  },
  credentials: false,
}));

// CORS error -> 403 JSON (instead of generic 500 HTML)
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

async function airtableSelectAll(tableName, options) {
  const records = [];
  await base(tableName).select(options).eachPage((pageRecords, fetchNextPage) => {
    records.push(...pageRecords);
    fetchNextPage();
  });
  return records;
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

// -------------------------
// Cache (simple in-memory) — good enough for a single Render instance
// -------------------------
const CACHE_TTL_MS = 60 * 1000; // 60s
let CACHE = {
  intents: { ts: 0, data: [] },
  outputRules: { ts: 0, data: [] },
  servicesByHotel: new Map(), // key: hotelSlug => { ts, rows }
};

function cacheFresh(ts) {
  return (Date.now() - ts) < CACHE_TTL_MS;
}

// -------------------------
// Load AI_INTENT_PATTERNS (WEB/BOTH)
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
      outputScope: pickFirstNonEmpty(f['Output Scope'], f.OutputScope, f.output_scope), // e.g. "General", "Room Guide", "City Guide"
      servicesLink: f['Services link'] ?? f.ServicesLink ?? f.services_link,
      roomsLink: f['Rooms link'] ?? f.RoomsLink ?? f.rooms_link,
    };
  }).filter(p => p.intent);

  // WEB widget: allow patterns with Applies to containing WEB or BOTH
  const filtered = patterns.filter(p => fieldHasAny(p.appliesTo, ['WEB', 'BOTH']));

  CACHE.intents = { ts: Date.now(), data: filtered };
  return filtered;
}

// -------------------------
// Load AI_OUTPUT_RULES (cached)
// -------------------------
async function loadOutputRules() {
  if (!cacheFresh(CACHE.outputRules.ts) || !CACHE.outputRules.data.length) {
    const recs = await airtableSelectAll(TABLE_OUTPUT_RULES, { pageSize: 100 });

    const rules = recs.map(r => {
      const f = r.fields || {};
      return {
        id: r.id,
        refId: pickFirstNonEmpty(f['Ref ID'], f.RefID, f.ref_id),
        scope: pickFirstNonEmpty(f.Scope, f.scope), // "General", "Room Guide", "City Guide", "Requests"
        format: pickFirstNonEmpty(f.Format, f.format),
        style: pickFirstNonEmpty(f.Style, f.style),
        example: pickFirstNonEmpty(f['Example Output'], f.ExampleOutput, f.example_output),
        priority: Number(f.Priority ?? f.priority ?? 0),
        isActive: (f['Is Active'] ?? f.IsActive ?? f.is_active ?? true) === true,
        aiSource: asArray(f.AI_SOURCE ?? f.ai_source), // WEB/PWA/POI/ROUTES...
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
// Choose intent (GPT-assisted) from patterns list
// -------------------------
async function chooseIntent(question, patterns) {
  if (!patterns.length) return { intent: null, confidence: 0, note: 'no_patterns', outputScope: 'General' };

  const validIntents = new Set(patterns.map(p => String(p.intent)));

  // Keep list concise
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

    // Safety: if model returns an intent not in list, ignore it
    if (intent && !validIntents.has(intent)) intent = null;

    return { intent, confidence, outputScope, note: parsed.note || '' };
  } catch (e) {
    console.error('chooseIntent error:', e);
    return { intent: null, confidence: 0, outputScope: 'General', note: 'intent_router_failed' };
  }
}

// -------------------------
// Load SERVICES rows per hotel (cached) and filter for WEB
// -------------------------
async function getServicesForHotelWeb(hotelSlug) {
  const cached = CACHE.servicesByHotel.get(String(hotelSlug));
  if (cached && cacheFresh(cached.ts) && Array.isArray(cached.rows)) return cached.rows;

  const recs = await airtableSelectAll(TABLE_SERVICES, { pageSize: 100 });

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
    };
  });

  const byHotel = rows.filter(r => String(r.hotelSlug) === String(hotelSlug));
  const bySourceWeb = byHotel.filter(r => fieldHasAny(r.aiSource, ['WEB', 'BOTH']));

  CACHE.servicesByHotel.set(String(hotelSlug), { ts: Date.now(), rows: bySourceWeb });
  return bySourceWeb;
}

function pickFallbackRecords(question, allForHotelWeb, limit = 3) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return [];

  const scored = allForHotelWeb.map(r => {
    const hay = normalizeText([
      r.naziv,
      r.kategorija.join(' '),
      r.opis,
      r.radnoVrijeme,
      r.aiIntent.join(' '),
    ].join(' '));

    let score = 0;
    for (const t of qTokens) {
      if (t.length < 3) continue;
      if (hay.includes(t)) score += 1;
    }

    return { r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(x => x.score > 0).slice(0, limit).map(x => x.r);
  return top;
}

async function fetchServiceRows({ hotelSlug, intent, question }) {
  const allForHotelWeb = await getServicesForHotelWeb(hotelSlug);

  const matched = intent
    ? allForHotelWeb.filter(r => r.aiIntent.map(String).includes(String(intent)))
    : [];

  // Fallback candidates if no match
  const fallback = (!matched.length)
    ? pickFallbackRecords(question, allForHotelWeb, 3)
    : [];

  return { matched, fallback, allForHotelWeb };
}

// -------------------------
// Build answer using records + output rules
// -------------------------
async function generateAnswer({ question, hotelSlug, intentPick, recordsToUse, outputRule }) {
  const styleText = outputRule
    ? `OUTPUT RULE (Scope=${outputRule.scope}, Format=${outputRule.format}):
STYLE: ${outputRule.style}
EXAMPLE: ${outputRule.example}`
    : 'OUTPUT RULE: none (use clear short paragraphs).';

  // Keep context tight
  const contextBlocks = recordsToUse.map((r, idx) => {
    const aiPromptShort = (r.aiPrompt || '').slice(0, 600);
    const opisShort = (r.opis || '').slice(0, 1200);

    return `# RECORD ${idx + 1}
Naziv: ${r.naziv}
Kategorija: ${r.kategorija.join(', ')}
Radno vrijeme: ${r.radnoVrijeme || '-'}
Opis: ${opisShort}
AI_PROMPT (internal): ${aiPromptShort || '-'}`;
  });

  const sys = `You are "AI Olly" — a hotel web assistant for website visitors.
CRITICAL RULES:
- This is the WEB widget (website visitors). Do NOT assume the user is a checked-in guest.
- HOTEL-SPECIFIC facts MUST come from provided RECORDS. If missing, say you don't have that info and suggest contacting reception.
- You MAY answer general tourist questions about Split / Diocletian's Palace in a safe general way (what it is, history basics, typical visiting tips).
  You MUST NOT invent hotel details, prices, schedules, or internal procedures.
- If you have multiple possible interpretations, ask ONE short clarifying question.

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

  return resp.choices?.[0]?.message?.content?.trim() || '';
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

    // 1) Load patterns (WEB/BOTH)
    const patterns = await getIntentPatternsForWeb();

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

    // 3) Fetch SERVICES records
    const { matched, fallback, allForHotelWeb } = await fetchServiceRows({
      hotelSlug,
      intent: intentPick.intent,
      question,
    });

    // records to use in prompt:
    const recordsToUse = matched.length ? matched : fallback;

    // 4) Output rule (by scopeWanted, source WEB). If missing, fallback to General/WEB
    let outputRule = await getOutputRule({ scopeWanted, aiSourceWanted: 'WEB' });
    if (!outputRule && String(scopeWanted).toLowerCase() !== 'general') {
      outputRule = await getOutputRule({ scopeWanted: 'General', aiSourceWanted: 'WEB' });
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
        usedRecords: recordsToUse.map(r => ({ naziv: r.naziv, id: r.id })),
        usedFallback: (!matched.length && fallback.length) ? true : false,
        totalWebRecordsForHotel: allForHotelWeb.length,
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

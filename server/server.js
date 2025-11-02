// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Airtable from "airtable";

dotenv.config();

const {
  PORT = 8080,
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  CORS_ORIGINS = "",
  AIRTABLE_TABLE_REQUESTS = "REQUESTS",
} = process.env;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error("❗ Nedostaju AIRTABLE_API_KEY ili AIRTABLE_BASE_ID u .env / Render env varijablama");
  process.exit(1);
}

// Airtable init
const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// ------------------------------
// Pomoćna funkcija: čitanje tablice s paginacijom
// ------------------------------
async function readTable(tableName, { view, maxRecords = 100 } = {}) {
  const params = { maxRecords };
  if (typeof view === "string" && view.trim()) {
    params.view = view.trim();
  }
  const records = [];
  await base(tableName)
    .select(params)
    .eachPage((pageRecords, fetchNextPage) => {
      records.push(
        ...pageRecords.map((r) => ({
          id: r.id,
          fields: r.fields,
        }))
      );
      fetchNextPage();
    });
  return records;
}

// ------------------------------
// Express init + CORS
// ------------------------------
const app = express();

// JSON body parser (za POST requeste)
app.use(express.json({ limit: "1mb" }));

// CORS whitelist iz .env (comma-separated)
const allowed = CORS_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // dopušta zahtjeve bez Origin headera (curl/Postman)
      if (!origin) return cb(null, true);
      return cb(null, allowed.includes(origin));
    },
    credentials: true,
  })
);

// Preflight u Express 5: koristimo (.*), ne "*"
app.options("(.*)", cors());

// ------------------------------
// Health
// ------------------------------
app.get("/", (_req, res) => {
  res.send("✅ AI Olly backend radi!");
});

// Test konekcije
app.get("/api/airtable-test", async (_req, res) => {
  try {
    const out = await readTable("POI", { maxRecords: 3 });
    res.json(out.map((r) => ({ id: r.id })));
  } catch (err) {
    console.error(err);
    res.status(500).send("Greška pri spajanju na Airtable");
  }
});

/** ========== PUBLIC READ ENDPOINTS ========== **/

// 1) POI
app.get("/api/poi", async (req, res) => {
  try {
    const view = req.query.view || undefined; // opcionalno ?view=
    const data = await readTable("POI", { view, maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("POI error:", err);
    res.status(500).json({ error: "POI read error" });
  }
});

// POI by ID
app.get("/api/poi/:id", async (req, res) => {
  try {
    const rec = await base("POI").find(req.params.id);
    res.json({ id: rec.id, fields: rec.fields });
  } catch (err) {
    console.error("POI by id error:", err);
    res.status(404).json({ error: "POI not found" });
  }
});

// 2) ROUTES
app.get("/api/routes", async (_req, res) => {
  try {
    const data = await readTable("ROUTES", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("ROUTES error:", err);
    res.status(500).json({ error: "ROUTES read error" });
  }
});

// 3) ROOM GUIDE
app.get("/api/room-guide", async (_req, res) => {
  try {
    const data = await readTable("ROOM GUIDE", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("ROOM GUIDE error:", err);
    res.status(500).json({ error: "ROOM GUIDE read error" });
  }
});

// 4) INFO
app.get("/api/info", async (_req, res) => {
  try {
    const data = await readTable("INFO", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("INFO error:", err);
    res.status(500).json({ error: "INFO read error" });
  }
});

/** ========== WRITE ENDPOINT: REQUESTS ========== **/

// Mapiranje body -> Airtable kolone (po potrebi prilagodi desne nazive)
const FIELD_MAP = {
  hotelSlug: "Hotel Slug",
  roomNumber: "Naziv sobe",
  category: "Kategorija",
  priority: "Prioritet",
  message: "Poruka",
  guestName: "Gost - ime",
  phone: "Telefon",
  status: "Status",
};

function buildRequestFields(body = {}) {
  const {
    hotelSlug,
    roomNumber,
    category,
    priority,
    message,
    guestName,
    phone,
  } = body;

  const errors = [];
  if (!message) errors.push("message is required");
  if (!hotelSlug) errors.push("hotelSlug is required");

  if (errors.length) {
    const err = new Error("Validation failed");
    err.statusCode = 400;
    err.details = errors;
    throw err;
  }

  const fields = {};
  fields[FIELD_MAP.hotelSlug] = String(hotelSlug);
  if (roomNumber !== undefined && roomNumber !== null) {
    fields[FIELD_MAP.roomNumber] = String(roomNumber);
  }
  if (category) fields[FIELD_MAP.category] = String(category);
  fields[FIELD_MAP.priority] = String(priority || "Normal");
  fields[FIELD_MAP.message] = String(message);
  if (guestName) fields[FIELD_MAP.guestName] = String(guestName);
  if (phone) fields[FIELD_MAP.phone] = String(phone);
  fields[FIELD_MAP.status] = "New";

  return fields;
}

// POST /api/requests — upis u Airtable tablicu REQUESTS
app.post("/api/requests", async (req, res) => {
  try {
    const fields = buildRequestFields(req.body);
    const created = await base(AIRTABLE_TABLE_REQUESTS).create([{ fields }], {
      typecast: true,
    });
    const rec = created[0];
    return res.status(201).json({ id: rec.id, fields: rec.fields });
  } catch (e) {
    console.error("REQUESTS create error:", e);
    const code = e.statusCode || 500;
    return res.status(code).json({
      error: e.message || "Unexpected error",
      details: e.details || null,
    });
  }
});

// (opcionalno) health endpoint za tablicu REQUESTS
app.get("/api/requests/health", (_req, res) =>
  res.json({ ok: true, table: AIRTABLE_TABLE_REQUESTS })
);

// ------------------------------
// Start
// ------------------------------
app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});

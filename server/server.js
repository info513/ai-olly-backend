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
} = process.env;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.error("❗ Nedostaju AIRTABLE_API_KEY ili AIRTABLE_BASE_ID u .env / Render env varijablama");
  process.exit(1);
}

// Airtable init
const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// Pomoćna funkcija: čitanje tablice s paginacijom
async function readTable(tableName, { view = undefined, maxRecords = 100 } = {}) {
  const records = [];
  await base(tableName)
    .select({ view, maxRecords })
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

// Express init
const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get("/", (_req, res) => {
  res.send("✅ AI Olly backend radi!");
});

// Test konekcije (već radi)
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
    const view = req.query.view || undefined; // možeš kreirati view u Airtableu i proslijediti ?view=
    const data = await readTable("POI", { view, maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("POI error:", err);
    res.status(500).json({ error: "POI read error" });
  }
});

// POI by ID (primjer)
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
app.get("/api/routes", async (req, res) => {
  try {
    const data = await readTable("ROUTES", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("ROUTES error:", err);
    res.status(500).json({ error: "ROUTES read error" });
  }
});

// 3) ROOM GUIDE
app.get("/api/room-guide", async (req, res) => {
  try {
    const data = await readTable("ROOM GUIDE", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("ROOM GUIDE error:", err);
    res.status(500).json({ error: "ROOM GUIDE read error" });
  }
});

// 4) INFO
app.get("/api/info", async (req, res) => {
  try {
    const data = await readTable("INFO", { maxRecords: 100 });
    res.json(data);
  } catch (err) {
    console.error("INFO error:", err);
    res.status(500).json({ error: "INFO read error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});

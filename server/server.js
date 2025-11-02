import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.get("/", (req, res) => {
  res.send("✅ AI Olly backend radi!");
});
app.get('/api/airtable-test', async (req, res) => {
  try {
    const Airtable = await import('airtable');
    const base = new Airtable.default({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
    const records = await base('POI').select({ maxRecords: 3 }).firstPage();
    res.json(records.map(r => ({ id: r.id, name: r.fields.Naziv })));
  } catch (err) {
    console.error(err);
    res.status(500).send('Greška pri spajanju na Airtable');
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server radi na portu ${PORT}`));

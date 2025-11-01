import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.get("/", (req, res) => {
  res.send("✅ AI Olly backend radi!");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server radi na portu ${PORT}`));

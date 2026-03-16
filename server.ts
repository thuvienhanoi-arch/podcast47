import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import textToSpeech from '@google-cloud/text-to-speech';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
const db = new Database("summaries.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    summary TEXT,
    key_points TEXT,
    analysis TEXT,
    intro TEXT,
    type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, "public")));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // TTS route
  app.post("/api/tts", async (req, res) => {
    const { text, voiceName, languageCode } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
      const client = new textToSpeech.TextToSpeechClient();
      const request = {
        input: { text },
        voice: { languageCode: languageCode || 'vi-VN', name: voiceName || 'vi-VN-Wavenet-A' },
        audioConfig: { audioEncoding: 'MP3' as const },
      };

      const [response] = await client.synthesizeSpeech(request);
      res.set('Content-Type', 'audio/mpeg');
      res.send(response.audioContent);
    } catch (error) {
      console.error("TTS error:", error);
      res.status(500).json({ error: "Failed to generate audio" });
    }
  });

  // Get all summaries
  app.get("/api/summaries", (req, res) => {
    try {
      const summaries = db.prepare("SELECT * FROM summaries ORDER BY created_at DESC").all();
      res.json(summaries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch summaries" });
    }
  });

  // Save a summary
  app.post("/api/summaries", (req, res) => {
    const { title, author, summary, key_points, analysis, intro, type } = req.body;
    try {
      const info = db.prepare(`
        INSERT INTO summaries (title, author, summary, key_points, analysis, intro, type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(title, author, summary, key_points, analysis, intro, type);
      res.json({ id: info.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: "Failed to save summary" });
    }
  });

  // Delete a summary
  app.delete("/api/summaries/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM summaries WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete summary" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

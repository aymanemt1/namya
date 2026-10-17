import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { handleChat } from "./lib/assistant.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY — copy .env.example to .env and paste your free key from https://aistudio.google.com/apikey");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, memories, images } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array" });
    const { reply, newMemories } = await handleChat(messages, {
      memories: Array.isArray(memories) ? memories : [],
      images: Array.isArray(images) ? images : [],
    });
    res.json({ reply, newMemories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Assistant error — check server logs and your API key." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Namya running at http://localhost:${PORT}`));

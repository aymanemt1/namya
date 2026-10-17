# Namya 100% Local — Ollama Setup (Windows, ~10 min)

Goal: Namya running fully on YOUR PC, no API, no quota, no limits.
Works offline (the model itself needs no internet; web_search/fetch_page tools still need internet).

**What changes:** only `lib/assistant.js` — Ollama speaks the same "OpenAI-compatible" API as Groq.

## 1. Install Ollama
- Download: https://ollama.com/download → **OllamaSetup.exe** → install → it runs in the system tray automatically.

## 2. Pull a model (one-time download)
Open **PowerShell** and run:
```powershell
ollama pull llama3.1:8b
```
(~4.7 GB download. Needs ~8 GB free RAM to run comfortably. Slower on CPU-only PCs, still usable.)

Alternative if his PC is strong (16 GB+ RAM): `ollama pull qwen2.5:14b` (smarter, heavier).

## 3. Point Namya at Ollama
In `~/workspace/namya/lib/assistant.js`, change 3 lines:

```js
const MODEL = "llama3.1:8b";                      // was "openai/gpt-oss-120b"
const API_BASE = "http://localhost:11434/v1";      // was "https://api.groq.com/openai/v1"
```
And in `getKey()`, return `"ollama"` instead of throwing when the key is missing (Ollama ignores the bearer token).

## 4. Run
```powershell
cd <namya folder>
npm start
```
Open `http://localhost:3000` — done. Unlimited.

## Honest caveats (tell him)
- **Local only** — this runs on his PC, not on namya-ai.vercel.app (the public site keeps Groq; a website can't reach his localhost).
- **Dumber model** — llama3.1:8b is far smaller than gpt-oss-120b: weaker reasoning, may drift out of Latin-script Darija on long answers, weaker tool-use. The system prompt helps; expect ~70% of the quality.
- **Memory** still works (localStorage), tools still work (they never needed the model API).
- **PC must stay on** while he uses it.

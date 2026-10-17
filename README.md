# Namya — AI Assistant

**Namya** ("Ayman" reversed) — a personal AI assistant built by Aymane
Moutoute. Chat UI powered by Llama 3.3 (via Groq's free tier API),
running on an adapted system prompt, with function-calling tools and
image vision.

## Tools

- `get_current_time` — current date/time
- `web_search` — quick web lookup (DuckDuckGo instant answers)
- `fetch_page` — read the text content of any web page URL
- `calculate` — math expressions
- `execute_js` — sandboxed JavaScript expressions (Math, JSON, Array…)
- `save_memory` — remembers durable facts about the user (stored in the
  browser's localStorage, sent with each request)
- **Images** — attach a photo; Gemini sees and answers about it

## Setup (5 minutes)

1. Get a **free** Groq API key: https://console.groq.com/keys
   (no credit card needed — generous free limits: ~1,000 requests/day)
2. Copy the env file and paste your key:
   ```bash
   cp .env.example .env
   # edit .env and replace PASTE_YOUR_KEY_HERE
   ```
   Never share your key or commit `.env`.
3. Install and run:
   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:3000

## What's inside

- `system-prompt.md` — the adapted system prompt (identity, personality,
  values, writing style, safety). Edit it to change how Namya behaves.
- `lib/assistant.js` — shared Gemini + tools logic (used by both).
- `server.js` — local dev server (Express). Run with `npm start`.
- `api/chat.js` — Vercel serverless function (same logic, production).
- `public/index.html` — the chat UI (served statically): image attach,
  localStorage memory, memory viewer (🧠).

## Deploy

Push to GitHub, then deploy on Vercel — `api/chat.js` becomes a
serverless function and `public/` is served statically. Add
`GROQ_API_KEY` in Vercel → Settings → Environment Variables
(Production + Preview + Development), then redeploy from the dashboard
so the deployment picks up the variable.

# Mini Assistant

A simplified personal AI assistant: a chat UI powered by Google Gemini,
running on an **adapted** version of the system prompt, with 3 function-calling
tools: `get_current_time`, `web_search`, `calculate`. Uses Gemini 3.8 Flash.

## Setup (5 minutes)

1. Get a **free** Gemini API key: https://aistudio.google.com/apikey
   (no credit card needed)
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

- `system-prompt.md` — the adapted system prompt (personality, values,
  writing style, safety). Edit it to change how the assistant behaves.
- `lib/assistant.js` — shared Gemini + tools logic (used by both).
- `server.js` — local dev server (Express). Run with `npm start`.
- `api/chat.js` — Vercel serverless function (same logic, production).
- `public/index.html` — the chat UI (served statically).

## Make it yours

- **More tools:** add a function declaration in `server.js` + its
  implementation in `runTool()` (e.g. weather, notes, timers).
- **Memory:** store conversation summaries in a file/DB and prepend them
  to the system instruction — that's the biggest upgrade after tools.
- **Deploy:** push to GitHub, then import on Vercel — `api/chat.js`
  becomes a serverless function and `public/` is served statically.
  Add `GEMINI_API_KEY` in Vercel → Settings → Environment Variables.

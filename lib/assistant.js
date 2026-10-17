import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = fs.readFileSync(path.join(__dirname, "..", "system-prompt.md"), "utf8");

const MODEL = process.env.NAMYA_MODEL || "openai/gpt-oss-120b";
// Local (Ollama, no limits): set NAMYA_API_BASE=http://localhost:11434/v1
// Cloud (Groq): default, needs GROQ_API_KEY
const API_BASE = process.env.NAMYA_API_BASE || "https://api.groq.com/openai/v1";
const USE_LOCAL = !!process.env.NAMYA_API_BASE;

// Models available on the Groq cloud backend (tested 2026-10-17)
const GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", tools: true },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tools: true },
  { id: "qwen/qwen3.8-27b", label: "Qwen 27B", tools: true },
  { id: "allam-2-7b", label: "Allam 7B", tools: false },
];

function prettyLabel(id) {
  const base = id.split("/").pop();
  return base.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// List models for the active backend. Ollama: installed models via /api/tags.
export async function getModels() {
  if (process.env.NAMYA_MODELS) {
    return process.env.NAMYA_MODELS.split(",").map((s) => {
      const id = s.trim();
      return { id, label: prettyLabel(id), tools: true };
    }).filter((m) => m.id);
  }
  if (USE_LOCAL) {
    try {
      const base = API_BASE.replace(/\/v1$/, "");
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const list = (j.models || []).map((m) => ({ id: m.name, label: prettyLabel(m.name), tools: true }));
      if (list.length) return list;
    } catch {}
    return [{ id: MODEL, label: prettyLabel(MODEL), tools: true }];
  }
  return GROQ_MODELS;
}

export function defaultModelId() {
  return MODEL;
}

function getKey() {
  if (USE_LOCAL) return "ollama"; // Ollama needs no key
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY (or set NAMYA_API_BASE for local Ollama)");
  return key;
}

async function chatCompletions(model, messages, tools) {
  const r = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getKey()}` },
    body: JSON.stringify({ model, messages, tools }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`API error ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j.choices[0].message;
}

// ---- Gemini vision (free tier, for image messages) ----
async function geminiVision(apiKey, images, userText) {
  const parts = [{ text: String(userText || "What do you see in this image? Describe it in detail.").slice(0, 2000) }];
  for (const img of images) {
    if (!img || !img.data) continue;
    parts.push({
      inline_data: {
        mime_type: img.mimeType || "image/jpeg",
        data: String(img.data),
      },
    });
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(60000),
    }
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Gemini error ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

// ---- Tool implementations ----
export async function runTool(name, args = {}) {
  if (name === "get_current_time") {
    return { datetime: new Date().toString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  if (name === "calculate") {
    const expr = String(args.expression || "");
    if (!/^[0-9+\-*/().\s%^]+$/.test(expr)) return { error: "Invalid characters in expression" };
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${expr})`)();
      return { result: value };
    } catch {
      return { error: "Could not evaluate expression" };
    }
  }
  if (name === "execute_js") {
    const code = String(args.code || "").slice(0, 2000);
    if (!code.trim()) return { error: "Empty code" };
    try {
      const sandbox = { Math, JSON, Number, String, Boolean, Array, Object, parseInt, parseFloat, isNaN };
      const ctx = vm.createContext(sandbox);
      const result = vm.runInContext(`"use strict"; (${code})`, ctx, { timeout: 1500 });
      const str = typeof result === "string" ? result : JSON.stringify(result);
      return { result: String(str).slice(0, 2000) };
    } catch (e) {
      return { error: "Execution failed: " + String(e.message).slice(0, 200) };
    }
  }
  if (name === "web_search") {
    const q = encodeURIComponent(String(args.query || ""));
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`);
      const j = await r.json();
      const out = [];
      if (j.AbstractText) out.push(j.AbstractText);
      (j.RelatedTopics || []).slice(0, 5).forEach((t) => {
        if (t.Text) out.push(t.Text);
      });
      return { results: out.length ? out : ["No instant answer found — try a more specific query."] };
    } catch {
      return { error: "Search failed" };
    }
  }
  if (name === "fetch_page") {
    const url = String(args.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return { error: "URL must start with http:// or https://" };
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Namya/1.0 (+personal assistant)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return { error: `Page returned HTTP ${r.status}` };
      const ct = r.headers.get("content-type") || "";
      if (!/text|html/i.test(ct)) return { error: "Not a text/HTML page" };
      const html = await r.text();
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 8000) text = text.slice(0, 8000) + "... [truncated]";
      return { url, text: text || "[no readable text on page]" };
    } catch {
      return { error: "Could not fetch the page" };
    }
  }
  if (name === "save_memory") {
    const fact = String(args.fact || "").trim().slice(0, 500);
    if (!fact) return { error: "Empty fact" };
    return { saved: fact };
  }
  return { error: `Unknown tool: ${name}` };
}

export const functionDeclarations = [
  { name: "get_current_time", description: "Get the current date and time.", parameters: { type: "object", properties: {} } },
  {
    name: "calculate",
    description: "Evaluate a math expression, e.g. (12*3.5)/2.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  },
  {
    name: "execute_js",
    description: "Run a short JavaScript expression in a sandbox (Math, JSON, Array, String, Number available; 1.5s limit). The return value comes back. Use for logic, data transforms, date math.",
    parameters: { type: "object", properties: { code: { type: "string", description: "A JS expression, e.g. '[1,2,3].map(x=>x*2)'" } }, required: ["code"] },
  },
  {
    name: "web_search",
    description: "Quick web lookup for facts, definitions, current info.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "fetch_page",
    description: "Fetch a web page (URL) and read its text content. Use when the user shares a link or you need the actual page content.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "save_memory",
    description: "Save a durable fact about the user (name, preferences, decisions, context) so you remember it in future conversations.",
    parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
  },
];

export async function handleChat(messages, opts = {}) {
  getKey();
  const models = await getModels();
  const wanted = typeof opts.model === "string" ? opts.model : "";
  const picked = models.find((m) => m.id === wanted) || models.find((m) => m.id === MODEL) || models[0];
  const model = picked.id;
  const useTools = picked.tools !== false;
  const memories = Array.isArray(opts.memories) ? opts.memories.filter(Boolean).slice(0, 50) : [];
  const images = Array.isArray(opts.images) ? opts.images.slice(0, 3) : [];

  // Vision: route image messages to Gemini (free tier) when a key is configured.
  if (images.length) {
    const gemKey = process.env.GEMINI_API_KEY;
    if (!gemKey) {
      return {
        reply: "Tsawer mazal ma kan9darch nchoufhoum daba — khassni GEMINI_API_KEY f Vercel. Zidha w 3awd sift tswira.",
        newMemories: [],
      };
    }
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = (lastUser && lastUser.text) || "What do you see in this image? Describe it.";
    try {
      const reply = await geminiVision(gemKey, images, userText);
      return { reply, newMemories: [] };
    } catch (e) {
      console.error("gemini vision error:", e.message);
      return { reply: "Ma 9drtch nchouf tswira daba (mochkil f Gemini). 3awd jereb men be3d.", newMemories: [] };
    }
  }
  const sysExtra = memories.length
    ? "\n\n## What you remember about the user\n" + memories.map((m) => "- " + m).join("\n")
    : "";

  const apiMessages = [{ role: "system", content: SYSTEM + sysExtra }];
  messages.forEach((m) => {
    apiMessages.push({ role: m.role === "model" ? "assistant" : "user", content: m.text });
  });

  const tools = useTools ? functionDeclarations.map((d) => ({ type: "function", function: d })) : undefined;
  const newMemories = [];

  for (let i = 0; i < 6; i++) {
    const msg = await chatCompletions(model, apiMessages, tools);
    apiMessages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) return { reply: msg.content || "", newMemories };

    for (const tc of calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      const result = await runTool(tc.function.name, args);
      if (tc.function.name === "save_memory" && result.saved) newMemories.push(result.saved);
      apiMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  const msg = await chatCompletions(model, apiMessages, tools);
  return { reply: msg.content || "", newMemories };
}

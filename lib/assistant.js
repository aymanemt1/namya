import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = fs.readFileSync(path.join(__dirname, "..", "system-prompt.md"), "utf8");

const MODEL = "gemini-3.8-flash";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey: key });
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
  const ai = getClient();
  const tools = [{ functionDeclarations }];
  const memories = Array.isArray(opts.memories) ? opts.memories.filter(Boolean).slice(0, 50) : [];
  const images = Array.isArray(opts.images) ? opts.images.slice(0, 3) : [];

  const sysExtra = memories.length
    ? "\n\n## What you remember about the user\n" + memories.map((m) => "- " + m).join("\n")
    : "";

  const contents = messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  // Attach images to the latest user message
  if (images.length && contents.length) {
    const last = contents[contents.length - 1];
    for (const img of images) {
      if (img.data && img.mimeType) {
        last.parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
  }

  const newMemories = [];

  for (let i = 0; i < 6; i++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM + sysExtra, tools },
    });

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) return { reply: response.text, newMemories };

    // Replay the model's turn verbatim (preserves thoughtSignature etc.)
    const modelParts = response.candidates?.[0]?.content?.parts || [];
    contents.push({ role: "model", parts: modelParts });

    const parts = [];
    for (const c of calls) {
      const result = await runTool(c.name, c.args || {});
      if (c.name === "save_memory" && result.saved) newMemories.push(result.saved);
      parts.push({ functionResponse: { name: c.name, response: { output: result } } });
    }
    contents.push({ role: "user", parts });
  }

  const final = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: SYSTEM + sysExtra },
  });
  return { reply: final.text, newMemories };
}

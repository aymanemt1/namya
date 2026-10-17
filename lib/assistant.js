import fs from "fs";
import path from "path";
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
    name: "web_search",
    description: "Quick web lookup for facts, definitions, current info.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

export async function handleChat(messages) {
  const ai = getClient();
  const tools = [{ functionDeclarations }];

  let contents = messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  for (let i = 0; i < 6; i++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM, tools },
    });

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) return response.text;

    // Replay the model's turn verbatim (preserves thoughtSignature etc.)
    const modelParts = response.candidates?.[0]?.content?.parts || [];
    contents.push({ role: "model", parts: modelParts });

    const parts = [];
    for (const c of calls) {
      const result = await runTool(c.name, c.args || {});
      parts.push({ functionResponse: { name: c.name, response: { output: result } } });
    }
    contents.push({ role: "user", parts });
  }

  const final = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: SYSTEM },
  });
  return final.text;
}

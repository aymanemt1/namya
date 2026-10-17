import { handleChat } from "../lib/assistant.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { messages, memories, images, model } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array" });
    const { reply, newMemories } = await handleChat(messages, {
      memories: Array.isArray(memories) ? memories : [],
      images: Array.isArray(images) ? images : [],
      model: typeof model === "string" ? model : undefined,
    });
    return res.status(200).json({ reply, newMemories });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Assistant error — check the GROQ_API_KEY variable (or NAMYA_API_BASE for local mode)." });
  }
}

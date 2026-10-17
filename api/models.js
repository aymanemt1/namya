import { getModels, defaultModelId } from "../lib/assistant.js";

export default async function handler(req, res) {
  try {
    const models = await getModels();
    res.json({ models, def: defaultModelId() });
  } catch (e) {
    res.status(500).json({ error: "Could not list models." });
  }
}

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const KB_PATH = path.join(process.cwd(), "questions.json");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function loadKB() {
  try {
    const raw = fs.readFileSync(KB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { items: [], meta: {} };
  }
}

export async function saveKB(kb: any) {
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), "utf8");
  return kb;
}

export async function embed(text: string): Promise<number[]> {
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text || ""
    });
    return res.data[0]?.embedding || [];
  } catch {
    return [];
  }
}

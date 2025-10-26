import OpenAI from "openai";
import { readBatch, QAItem } from "./kb";
import { saveEmbeddingsToSupabase } from "./db";

const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const PREC = Number(process.env.EMBED_ROUND || 6);
const round = (v:number) => Number(v.toFixed(PREC));

function chunk<T>(arr: T[], n = 64): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function embedBatch(batchId: string) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!client.apiKey) throw new Error("OPENAI_API_KEY is not set");

  const items: QAItem[] = await readBatch(batchId);
  if (!items.length) return { batchId, count: 0, embeddingsKey: null };

  const inputs = items.map(it => it.Q || "");
  const byChunks = chunk(inputs, 64);

  const vectors: { id:string; embedding:number[] }[] = [];
  let idx = 0;

  for (const inputsChunk of byChunks) {
    const resp = await client.embeddings.create({ model: MODEL, input: inputsChunk });
    resp.data.forEach(row => {
      const item = items[idx++];
      vectors.push({ id: item.id, embedding: row.embedding.map(round) });
    });
  }

  await saveEmbeddingsToSupabase(batchId, vectors);

  return { batchId, count: items.length, embeddingsKey: null };
}

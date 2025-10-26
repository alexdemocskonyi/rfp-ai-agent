import OpenAI from "openai";
import { supa, hasSupabase } from "./supadb";

type EmbRow = { id: string; batchId: string; Q: string; embedding: number[] };

export type SearchHit = {
  id: string;
  batchId: string;
  Q: string;
  A: string;
  source?: string;
  score: number;
  scores: { semantic: number; lexical: number };
};

const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const LEXICAL_WEIGHT = 0.25;
const LAMBDA_MMR = 0.6;

function tok(s: string): string[] {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
function lexicalScore(a: string, b: string): number {
  const A = new Set(tok(a)), B = new Set(tok(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  const denom = Math.max(3, Math.min(A.size, B.size));
  return inter / denom;
}
function cosine(a: number[], b: number[]): number {
  let dot=0, na=0, nb=0;
  for (let i=0;i<Math.min(a.length,b.length);i++){ const x=a[i],y=b[i]; dot+=x*y; na+=x*x; nb+=y*y; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na)*Math.sqrt(nb));
}

type Cand = { score:number; sem:number; lex:number; emb:number[]; row: EmbRow };
function mmr(candidates: Cand[], k: number, lambda=LAMBDA_MMR): Cand[] {
  const selected: Cand[] = [];
  const pool = candidates.slice().sort((x,y)=>y.score-x.score);
  while (selected.length < k && pool.length) {
    let bestIdx=0, bestVal=-1;
    for (let i=0;i<pool.length;i++){
      const c = pool[i];
      const diversity = selected.length ? Math.max(...selected.map(s=>cosine(c.emb, s.emb))) : 0;
      const val = lambda*c.score - (1-lambda)*diversity;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }
    selected.push(pool.splice(bestIdx,1)[0]);
  }
  return selected;
}

async function loadAllRows(): Promise<EmbRow[]> {
  if (!hasSupabase) return [];
  const page = 2000; let from = 0;
  const rows: EmbRow[] = [];
  while (true) {
    const { data, error } = await supa!.from("kb_embeddings")
      .select("item_id,batch_id,embedding")
      .range(from, from + page - 1);
    if (error) throw new Error("kb_embeddings select failed: " + error.message);
    if (!data || !data.length) break;
    const ids = data.map(d => d.item_id);
    const { data: items, error: e2 } = await supa!.from("kb_items")
      .select("id,q").in("id", ids);
    if (e2) throw new Error("kb_items select failed: " + e2.message);
    const qMap = new Map<string, string>((items || []).map(it => [it.id, it.q]));
    for (const d of data) {
      rows.push({ id: d.item_id, batchId: d.batch_id, Q: qMap.get(d.item_id) || "", embedding: (d as any).embedding });
    }
    from += page;
  }
  return rows;
}

async function loadBatchQA(batchId: string): Promise<Record<string, {Q:string;A:string;source?:string}>> {
  const { data, error } = await supa!.from("kb_items")
    .select("id,q,a,source").eq("batch_id", batchId);
  if (error) throw new Error("kb_items batch load failed: " + error.message);
  const out: Record<string, any> = {};
  for (const it of data || []) out[it.id] = { Q: it.q, A: it.a, source: it.source || undefined };
  return out;
}

export async function searchKB(query: string, k = 10): Promise<SearchHit[]> {
  if (!query || !query.trim()) return [];
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!client.apiKey) throw new Error("OPENAI_API_KEY is not set");

  const embQ = (await client.embeddings.create({ model: MODEL, input: query })).data[0].embedding;
  const rows = await loadAllRows();
  if (!rows.length) return [];

  const scored: Cand[] = rows.map(r => {
    const sem = cosine(embQ, r.embedding);
    const lex = lexicalScore(query, r.Q || "");
    const score = (1-LEXICAL_WEIGHT)*sem + LEXICAL_WEIGHT*lex;
    return { score, sem, lex, emb: r.embedding, row: r };
  });

  const top = mmr(scored, Math.min(k*3, scored.length));

  const byBatch = new Map<string, Cand[]>();
  for (const t of top) {
    if (!byBatch.has(t.row.batchId)) byBatch.set(t.row.batchId, []);
    byBatch.get(t.row.batchId)!.push(t);
  }

  const hydrated: SearchHit[] = [];
  for (const [batchId, cands] of byBatch.entries()) {
    const qa = await loadBatchQA(batchId);
    for (const c of cands) {
      const meta = qa[c.row.id] || { Q: c.row.Q, A: "", source: undefined };
      hydrated.push({
        id: c.row.id,
        batchId: c.row.batchId,
        Q: meta.Q,
        A: meta.A,
        source: meta.source,
        score: c.score,
        scores: { semantic: c.sem, lexical: c.lex }
      });
    }
  }
  return hydrated.sort((a,b)=>b.score-a.score).slice(0, k);
}

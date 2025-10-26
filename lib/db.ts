// lib/db.ts
import { supa, hasSupabase } from "./supadb";
import type { QAItem } from "./kb";

const ITEM_BATCH  = Number(process.env.SUPABASE_ITEM_UPSERT_CHUNK  || 200);
const EMB_BATCH   = Number(process.env.SUPABASE_EMBED_UPSERT_CHUNK || 100);
const CHUNK_BATCH = Number(process.env.SUPABASE_CHUNK_UPSERT_CHUNK || 80); // ↓ smaller default

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function tryUpsert(
  table: "kb_items" | "kb_embeddings" | "kb_chunks",
  rows: any[],
  onConflict: "id" | "item_id",
  attempt = 1
): Promise<void> {
  if (!rows.length) return;

  try {
    // No .select() => smaller response body
    const { error } = await supa!.from(table).upsert(rows, {
      onConflict,
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    const msg = String(err?.message || err);

    // Network / size / transient errors → split and retry halves
    const looksTransient = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|502|503|504|timeout/i.test(msg);

    if (looksTransient && rows.length > 1) {
      const mid = Math.ceil(rows.length / 2);
      // backoff a touch
      await sleep(150 * attempt);
      await tryUpsert(table, rows.slice(0, mid), onConflict, attempt + 1);
      await tryUpsert(table, rows.slice(mid), onConflict, attempt + 1);
      return;
    }

    // small batch & still failing → bubble up
    throw new Error(`${table} upsert failed: ${msg}`);
  }
}

async function chunkedUpsert(
  table: "kb_items" | "kb_embeddings" | "kb_chunks",
  rows: any[],
  onConflict: "id" | "item_id",
  chunkSize: number
) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await tryUpsert(table, chunk, onConflict);
  }
}

export async function saveItemsToSupabase(items: QAItem[]) {
  if (!hasSupabase) return { ok: false, skipped: "SUPABASE not configured" };
  const rows = items.map(it => ({
    id: it.id,
    batch_id: it.batchId,
    q: it.Q,
    a: it.A ?? "",
    source: it.source ?? null,
    created_at: it.createdAt ?? new Date().toISOString(),
  }));
  await chunkedUpsert("kb_items", rows, "id", ITEM_BATCH);
  return { ok: true, upserted: rows.length };
}

export async function saveEmbeddingsToSupabase(
  batchId: string,
  vectors: { id: string; embedding: number[] }[]
) {
  if (!hasSupabase) return { ok: false, skipped: "SUPABASE not configured" };
  const rows = vectors.map(v => ({
    item_id: v.id,
    batch_id: batchId,
    embedding: v.embedding, // JSONB
    created_at: new Date().toISOString(),
  }));
  await chunkedUpsert("kb_embeddings", rows, "item_id", EMB_BATCH);
  return { ok: true, upserted: rows.length };
}

export type ChunkRow = {
  id: string;
  item_id: string;
  batch_id: string;
  ord: number;
  content: string;
  token_count: number;
  created_at?: string;
};

export async function saveChunksToSupabase(rows: ChunkRow[]) {
  if (!hasSupabase) return { ok: false, skipped: "SUPABASE not configured" };
  await chunkedUpsert("kb_chunks", rows, "id", CHUNK_BATCH);
  return { ok: true, upserted: rows.length };
}

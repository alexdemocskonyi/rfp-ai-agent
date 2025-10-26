import { supa, hasSupabase } from "./supadb";
import type { QAItem } from "./kb";

const ITEM_BATCH = Number(process.env.SUPABASE_ITEM_UPSERT_CHUNK || 300);
const EMB_BATCH  = Number(process.env.SUPABASE_EMBED_UPSERT_CHUNK || 150);

async function chunkedUpsert(
  table: "kb_items" | "kb_embeddings",
  rows: any[],
  onConflict: "id" | "item_id",
  chunkSize: number
) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supa!.from(table).upsert(chunk, {
      onConflict,
      ignoreDuplicates: false,
    });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

export async function saveItemsToSupabase(items: QAItem[]) {
  if (!hasSupabase) return { ok:false, skipped:"SUPABASE not configured" };
  const rows = items.map(it => ({
    id: it.id,
    batch_id: it.batchId,
    q: it.Q,
    a: it.A ?? "",
    source: it.source ?? null,
    created_at: it.createdAt ?? new Date().toISOString(),
  }));
  await chunkedUpsert("kb_items", rows, "id", ITEM_BATCH);
  return { ok:true, upserted: rows.length };
}

export async function saveEmbeddingsToSupabase(batchId: string, vectors: { id:string; embedding:number[] }[]) {
  if (!hasSupabase) return { ok:false, skipped:"SUPABASE not configured" };
  const rows = vectors.map(v => ({
    item_id: v.id,
    batch_id: batchId,
    embedding: v.embedding, // JSONB
    created_at: new Date().toISOString(),
  }));
  await chunkedUpsert("kb_embeddings", rows, "item_id", EMB_BATCH);
  return { ok:true, upserted: rows.length };
}

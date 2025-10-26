import { supa, hasSupabase } from "./supadb";

export type QAItem = {
  id: string;
  Q: string;
  A: string;
  source?: string;
  batchId?: string;
  createdAt?: string;
};

export async function readBatch(batchId: string): Promise<QAItem[]> {
  if (!hasSupabase) throw new Error("Supabase not configured");

  const PAGE = Number(process.env.SUPABASE_READ_PAGE || 500);
  const out: QAItem[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supa!.from("kb_items")
      .select("id,q,a,source,batch_id,created_at")
      .eq("batch_id", batchId)
      .range(from, from + PAGE - 1);

    if (error) throw new Error("readBatch failed: " + error.message);
    if (!data || data.length === 0) break;

    for (const r of data) {
      out.push({
        id: r.id,
        Q: r.q,
        A: r.a ?? "",
        source: r.source ?? undefined,
        batchId: r.batch_id,
        createdAt: r.created_at,
      });
    }

    if (data.length < PAGE) break; // last page
    from += PAGE;
  }

  return out;
}

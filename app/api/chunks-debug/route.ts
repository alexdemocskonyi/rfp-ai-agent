import { NextResponse } from "next/server";
import { supa, hasSupabase } from "@/lib/supadb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasSupabase) {
    return NextResponse.json({ ok:false, error:"Supabase not configured" }, { status:500 });
  }
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId") || undefined;

  const chunks = batchId
    ? await supa!.from("kb_chunks").select("id,batch_id,ord,token_count").eq("batch_id", batchId).limit(5)
    : await supa!.from("kb_chunks").select("id,batch_id,ord,token_count").order("created_at", { ascending:false }).limit(5);

  const count = batchId
    ? await supa!.from("kb_chunks").select("count", { count:"exact", head:true }).eq("batch_id", batchId)
    : await supa!.from("kb_chunks").select("count", { count:"exact", head:true });

  return NextResponse.json({
    ok: !chunks.error && !count.error,
    error: chunks.error?.message || count.error?.message || null,
    batchId: batchId || null,
    total: count.count ?? 0,
    sample: chunks.data ?? []
  });
}

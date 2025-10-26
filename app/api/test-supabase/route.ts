import { NextResponse } from "next/server";
import { supa, hasSupabase } from "@/lib/supadb";
export async function GET() {
  if (!hasSupabase) return NextResponse.json({ ok:false, error:"Supabase not configured" }, { status: 500 });
  const items = await supa!.from("kb_items").select("count", { count:"exact", head:true });
  const emb   = await supa!.from("kb_embeddings").select("count", { count:"exact", head:true });
  return NextResponse.json({ ok:true, itemsCount: items.count ?? null, embeddingsCount: emb.count ?? null });
}

import { NextResponse } from "next/server";
import { supa, hasSupabase } from "@/lib/supadb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasSupabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 }
    );
  }

  // Total items
  const items = await supa!.from("kb_items").select("count", { count: "exact", head: true });

  // Total embeddings
  const emb = await supa!.from("kb_embeddings").select("count", { count: "exact", head: true });

  // Content mix
  const qaPairs = await supa!
    .from("kb_items")
    .select("count", { count: "exact", head: true })
    .neq("a", ""); // a != '' → has an answer

  const qOnly = await supa!
    .from("kb_items")
    .select("count", { count: "exact", head: true })
    .eq("a", ""); // a == '' → Q-only

  return NextResponse.json({
    ok: true,
    itemsCount: items.count ?? 0,
    embeddingsCount: emb.count ?? 0,
    qaPairsCount: qaPairs.count ?? 0,
    qOnlyCount: qOnly.count ?? 0,
  });
}

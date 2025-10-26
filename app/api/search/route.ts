import { NextResponse } from "next/server";
import { searchKB } from "@/lib/retriever";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { q, k } = await req.json().catch(() => ({}));
    if (!q || !String(q).trim()) {
      return NextResponse.json({ ok: false, error: "q (query) is required" }, { status: 400 });
    }
    const hits = await searchKB(String(q), Math.max(1, Math.min(Number(k)||10, 50)));
    return NextResponse.json({ ok: true, count: hits.length, hits });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

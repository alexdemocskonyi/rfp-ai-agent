import { NextResponse } from "next/server";
import { embedBatch } from "@/lib/embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { batchId } = await req.json().catch(() => ({}));
    if (!batchId) return NextResponse.json({ ok: false, error: "batchId required" }, { status: 400 });
    const out = await embedBatch(batchId);
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

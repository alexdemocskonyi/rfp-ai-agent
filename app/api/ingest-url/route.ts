// app/api/ingest-url/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { QAItem } from "@/lib/kb";
import { embedBatch } from "@/lib/embed";
import { saveItemsToSupabase, saveChunksToSupabase, ChunkRow } from "@/lib/db";
import { makeChunks } from "@/lib/chunker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeRow(row: Record<string, any>) {
  const q = row.Q ?? row.Question ?? row.question ?? row.prompt ?? row.Prompt ?? "";
  const a = row.A ?? row.Answer ?? row.answer ?? row.response ?? row.Response ?? "";
  return { Q: String(q || "").trim(), A: String(a || "").trim() };
}

function extractQAFromWorkbook(file: Buffer, source: string) {
  const workbook = XLSX.read(file, { type: "buffer" });
  const all: { Q: string; A: string; source: string }[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[sheetName], { defval: "" });
    for (const row of sheet) {
      const { Q, A } = normalizeRow(row);
      if (Q && Q.length >= 1) all.push({ Q, A, source });
    }
  }
  return all;
}

export async function POST(req: Request) {
  try {
    const { url, name: providedName } = await req.json();
    if (!url) return NextResponse.json({ ok: false, error: "Missing 'url'" }, { status: 400 });

    const r = await fetch(url);
    if (!r.ok) return NextResponse.json({ ok: false, error: "Fetch failed: " + r.status }, { status: 500 });

    const buf = Buffer.from(await r.arrayBuffer());
    const name = providedName || (new URL(url).pathname.split("/").pop() || "upload.bin");
    const ext = "." + (name.split(".").pop() || "").toLowerCase();

    const batchId = randomUUID();
    const items: QAItem[] = [];

    if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      const qa = extractQAFromWorkbook(buf, name);
      for (const row of qa) {
        items.push({ id: randomUUID(), Q: row.Q, A: row.A ?? "", source: row.source, batchId, createdAt: new Date().toISOString() });
      }
    } else if (ext === ".pdf") {
      const mod: any = await import("@cedrugs/pdf-parse");
      const pdfParse = (mod && "default" in mod) ? mod.default : mod;
      const data = await pdfParse(buf);
      items.push({ id: randomUUID(), Q: "PDF content from " + name, A: String(data?.text || "").slice(0, 20000), source: name, batchId, createdAt: new Date().toISOString() });
    } else if (ext === ".docx" || ext === ".docm") {
      const mammoth: any = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const text = String(value || "").trim();
      items.push({ id: randomUUID(), Q: ext.toUpperCase().slice(1) + " content from " + name, A: text.slice(0, 20000), source: name, batchId, createdAt: new Date().toISOString() });
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported file type: " + ext }, { status: 415 });
    }

    if (!items.length) return NextResponse.json({ ok: false, error: "No parsable Q/A found" }, { status: 400 });

    await saveItemsToSupabase(items);

    const chunkRows: ChunkRow[] = [];
    for (const it of items) {
      const q = (it.Q || "").trim();
      const a = (it.A || "").trim();
      const base = a ? q + "\n\n" + a : q;
      if (!base) continue;
      const made = makeChunks(base);
      for (const m of made) {
        chunkRows.push({
          id: randomUUID(),
          item_id: it.id,
          batch_id: batchId,
          ord: m.ord,
          content: m.content,
          token_count: m.token_count,
          created_at: new Date().toISOString(),
        });
      }
    }
    if (chunkRows.length) await saveChunksToSupabase(chunkRows);

    const embedOut = await embedBatch(batchId);
    return NextResponse.json({ ok: true, batchId, count: items.length, chunked: chunkRows.length, embedded: embedOut?.count ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

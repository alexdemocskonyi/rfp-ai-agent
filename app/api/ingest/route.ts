import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import * as XLSX from "xlsx";
import { QAItem } from "@/lib/kb";
import { embedBatch } from "@/lib/embed";
import { saveItemsToSupabase } from "@/lib/db";

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
    const form = await req.formData();
    const files = form.getAll("files").concat(form.getAll("file"));

    if (!files.length) {
      return NextResponse.json({ ok: false, error: "No files uploaded" }, { status: 400 });
    }

    const batchId = uuidv4();
    const items: QAItem[] = [];

    for (const f of files) {
      if (typeof f === "object" && "arrayBuffer" in f) {
        const file = f as File;
        const name = file.name || "upload.bin";
        const buf = Buffer.from(await file.arrayBuffer());
        const ext = "." + (name.split(".").pop() || "").toLowerCase();

        if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
          const qa = extractQAFromWorkbook(buf, name);
          for (const row of qa) {
            items.push({
              id: uuidv4(), Q: row.Q, A: row.A ?? "", source: row.source,
              batchId, createdAt: new Date().toISOString(),
            });
          }
        } else if (ext === ".pdf") {
          const mod: any = await import("@cedrugs/pdf-parse");
          const pdfParse = (mod && "default" in mod) ? mod.default : mod;
          const data = await pdfParse(buf);
          items.push({
            id: uuidv4(), Q: `PDF content from ${name}`,
            A: (data?.text || "").slice(0, 20000),
            source: name, batchId, createdAt: new Date().toISOString(),
          });
        } else {
          items.push({
            id: uuidv4(), Q: `File uploaded: ${name} (unsupported for structured parsing)`,
            A: "", source: name, batchId, createdAt: new Date().toISOString(),
          });
        }
      }
    }

    if (!items.length) {
      return NextResponse.json({ ok: false, error: "No parsable Q/A found" }, { status: 400 });
    }

    // 1) Save rows to Supabase
    await saveItemsToSupabase(items);

    // 2) Auto-embed (saves vectors to Supabase)
    const embedOut = await embedBatch(batchId);

    return NextResponse.json({
      ok: true, batchId, count: items.length,
      embedded: embedOut?.count ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

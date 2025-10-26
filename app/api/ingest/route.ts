// app/api/ingest/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { QAItem } from "@/lib/kb";
import { embedBatch } from "@/lib/embed";
import { saveItemsToSupabase, saveChunksToSupabase, ChunkRow } from "@/lib/db";
import { makeChunks } from "@/lib/chunker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- helpers ----------
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

function looksZip(buf: Buffer) {
  // DOCX/DOCM are zip containers that start with 'PK'
  return buf && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

// very small HTML entity decode for DOCX XML text
function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Naive but effective text puller: concatenates <w:t> nodes, adds newlines on <w:p>
function docxXmlToText(xml: string) {
  const withParas = xml.replace(/<w:p\b[^>]*>/g, "\n");
  const texts = Array.from(withParas.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)).map((m) =>
    decodeEntities(m[1])
  );
  return texts.join("");
}

// Fallback: manually unzip DOCX and read main/related XMLs
async function extractDocxWithZip(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default || (await import("jszip"));
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) =>
    /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/i.test(n)
  );
  const parts: string[] = [];
  for (const n of names) {
    const file = zip.file(n);
    if (!file) continue;
    const xml = await file.async("string");
    parts.push(docxXmlToText(xml));
  }
  const out = parts.join("\n").replace(/\s+/g, " ").trim();
  return out;
}
// ---------- /helpers ----------

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").concat(form.getAll("file"));
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "No files uploaded" }, { status: 400 });
    }

    const batchId = randomUUID();
    const items: QAItem[] = [];

    for (const f of files) {
      if (typeof f !== "object" || !("arrayBuffer" in f)) continue;

      const file = f as File;
      const name = file.name || "upload.bin";
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = "." + (name.split(".").pop() || "").toLowerCase();

      if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
        const qa = extractQAFromWorkbook(buf, name);
        for (const row of qa) {
          items.push({
            id: randomUUID(),
            Q: row.Q,
            A: row.A ?? "",
            source: row.source,
            batchId,
            createdAt: new Date().toISOString(),
          });
        }
      } else if (ext === ".pdf") {
        const mod: any = await import("@cedrugs/pdf-parse");
        const pdfParse = (mod && "default" in mod) ? mod.default : mod;
        const data = await pdfParse(buf);
        items.push({
          id: randomUUID(),
          Q: `PDF content from ${name}`,
          A: (data?.text || "").slice(0, 20000),
          source: name,
          batchId,
          createdAt: new Date().toISOString(),
        });
      } else if (ext === ".docx" || ext === ".docm") {
        let text = "";
        try {
          if (!looksZip(buf)) throw new Error("not-a-zip");
          // primary: mammoth
          const mammoth: any = await import("mammoth");
          const { value } = await mammoth.extractRawText({ buffer: buf });
          text = String(value || "").trim();
          if (!text) throw new Error("empty-doc");
        } catch {
          // fallback: unzip + pull XML text
          try {
            text = await extractDocxWithZip(buf);
          } catch (err: any) {
            const msg = String(err?.message || err);
            const friendly =
              /end of central directory|central directory|invalid|corrupt|not-a-zip/i.test(msg)
                ? "This file isn't a valid DOCX/DOCM (ZIP). Open in Word and 'Save As → .docx' or export to PDF."
                : "Couldn't extract text from this Word document. Try re-saving as DOCX or uploading as PDF.";
            return NextResponse.json({ ok: false, error: `DOCX parse failed: ${friendly}` }, { status: 415 });
          }
        }
        items.push({
          id: randomUUID(),
          Q: `${ext.toUpperCase().slice(1)} content from ${name}`,
          A: text.slice(0, 20000),
          source: name,
          batchId,
          createdAt: new Date().toISOString(),
        });
      } else {
        return NextResponse.json(
          { ok: false, error: `Unsupported file type: ${ext}. Use CSV/XLSX/PDF/DOCX.` },
          { status: 415 }
        );
      }
    }

    if (!items.length) {
      return NextResponse.json({ ok: false, error: "No parsable Q/A found" }, { status: 400 });
    }

    // 1) Save rows
    await saveItemsToSupabase(items);

    // 2) Build & save context chunks from Q + A (or Q if A empty)
    const chunkRows: ChunkRow[] = [];
    for (const it of items) {
      const q = (it.Q || "").trim();
      const a = (it.A || "").trim();
      const base = a ? `${q}\n\n${a}` : q;
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

    // 3) Auto-embed questions
    const embedOut = await embedBatch(batchId);

    return NextResponse.json({
      ok: true,
      batchId,
      count: items.length,
      chunked: chunkRows.length,
      embedded: embedOut?.count ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

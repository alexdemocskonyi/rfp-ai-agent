import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import * as docx from "docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const tokenize = (s: string) =>
  norm(s.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

type KBRow = { id: string; q: string | null; a: string | null; source: string | null };
type Ranked = KBRow & { sem: number; lex: number; hybrid: number };

async function hybridMatch(openai: OpenAI, supabase: any, question: string): Promise<{ best: Ranked | null; top: Ranked[] }> {
  const emb = await openai.embeddings.create({ model: EMB_MODEL, input: question });
  const qvec = emb.data[0].embedding;

  let sem: Array<{ id: string; score: number }> = [];
  try {
    const { data } = await supabase.rpc("match_kb_items", { query_embedding: qvec, match_count: 40 } as any);
    sem = Array.isArray(data) ? data : [];
  } catch {
    sem = [];
  }
  const ids: string[] = sem.map((r) => r.id);
  if (!ids.length) return { best: null, top: [] };

  const { data: rows } = await supabase.from("kb_items").select("id,q,a,source").in("id", ids);
  const arr: KBRow[] = Array.isArray(rows) ? (rows as KBRow[]) : [];

  const qTokens = new Set<string>(tokenize(question));

  const ranked: Ranked[] = arr
    .map((r: KBRow): Ranked => {
      const text = `${r.q || ""} ${r.a || ""}`;
      const docTokens = new Set<string>(tokenize(text));
      let overlap = 0;
      qTokens.forEach((t) => {
        if (docTokens.has(t)) overlap++;
      });
      const lex = qTokens.size ? overlap / Math.max(qTokens.size, 1) : 0;
      const semScore = sem.find((s) => s.id === r.id)?.score ?? 0;
      const hybrid = 0.7 * semScore + 0.3 * lex;
      return { ...r, sem: semScore, lex, hybrid };
    })
    .filter((r: Ranked) => norm(r.a || "").length > 0)
    .sort((a: Ranked, b: Ranked) => b.hybrid - a.hybrid);

  return { best: ranked[0] || null, top: ranked.slice(0, 5) };
}

// simple question extractor
function extractQuestions(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const qs = lines.filter(
    (l) =>
      /\?$/.test(l) ||
      /^[-*•\d]+\./.test(l) ||
      /^describe\b/i.test(l) ||
      /^how\b/i.test(l)
  );
  return Array.from(new Set(qs)).slice(0, 80);
}

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing server envs");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const filename = (file?.name || "document").replace(/[^\w.\-]+/g, "_");

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded (multipart/form-data, field: file)" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const txt = buf.toString("utf8");
    const questions = extractQuestions(txt).slice(0, 40);

    const answers: Array<{ q: string; best?: Ranked; top: Ranked[] }> = [];
    const unanswered: string[] = [];

    for (const q of questions) {
      const { best, top } = await hybridMatch(openai, supabase as any, q);
      if (!best || best.hybrid < 0.42) {
        unanswered.push(q);
      } else {
        answers.push({ q, best, top });
      }
    }

    const children: docx.Paragraph[] = [];
    children.push(new docx.Paragraph({ text: `RFP Report for ${filename}`, heading: docx.HeadingLevel.TITLE }));

    if (answers.length) {
      children.push(new docx.Paragraph({ text: "Contextual Answers", heading: docx.HeadingLevel.HEADING_1 }));
      for (const a of answers) {
        children.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: `Q: ${a.q}`, bold: true })],
          spacing: { after: 120 },
        }));
        if (a.best) {
          children.push(new docx.Paragraph({ text: `A: ${a.best.a || ""}`, spacing: { after: 60 } }));
          children.push(new docx.Paragraph({
            text: `Source: ${a.best.source || "kb_items"} | scores(hybrid/sem/lex): ${a.best.hybrid.toFixed(3)}/${a.best.sem.toFixed(3)}/${a.best.lex.toFixed(3)}`,
            spacing: { after: 200 },
          }));
        }
      }
    }

    if (unanswered.length) {
      children.push(new docx.Paragraph({ text: "Unanswered Questions", heading: docx.HeadingLevel.HEADING_1 }));
      for (const q of unanswered) children.push(new docx.Paragraph({ text: `• ${q}` }));
    }

    const ai = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.3,
      messages: [{ role: "user", content: `Propose next actions based on these questions:\n${questions.slice(0, 20).join("\n")}` }],
    });
    children.push(new docx.Paragraph({ text: "AI-Derived Next Steps", heading: docx.HeadingLevel.HEADING_1 }));
    children.push(new docx.Paragraph({ text: norm(ai.choices[0]?.message?.content || "—") }));

    const doc = new docx.Document({ sections: [{ children }] });
    const buffer = await docx.Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);

    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="RFP_Report_${Date.now()}.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

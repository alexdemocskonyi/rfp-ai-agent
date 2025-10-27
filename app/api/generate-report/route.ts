import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as docx from "docx";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

function norm(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((i: any) => i.str).join(" ") + "\n";
  }
  return text;
}

async function matchFromKB(supabase: any, openai: OpenAI, q: string) {
  const emb = await openai.embeddings.create({ model: EMB_MODEL, input: q });
  const qvec = emb.data[0].embedding;

  let sem: any[] = [];
  try {
    const { data, error } = await supabase.rpc("match_kb_items", {
      query_embedding: qvec,
      match_count: 40,
    });
    if (error) console.warn("Supabase RPC error:", error);
    sem = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Supabase RPC exception:", err);
  }

  const ids = sem.map((r: any) => r.id);
  const { data: rows } = await supabase.from("kb_items").select("id,q,a,source").in("id", ids);
  if (!rows?.length) return { contextual: null, top: [] };

  const candidates = rows.slice(0, 10);
  const hybrid = await Promise.all(
    candidates.map(async (r: { id: string; q: string; a: string; source: string }) => {
      const lexical = (r.q + r.a).toLowerCase().includes(q.toLowerCase()) ? 1 : 0.5;
      const semScore = sem.find((s: any) => s.id === r.id)?.score || 0.5;
      const hybridScore = 0.6 * semScore + 0.4 * lexical;

      const check = await openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: "Reply only 'yes' if the passage directly answers the question." },
          { role: "user", content: `Question: ${q}\nPassage: ${r.a}` },
        ],
      });

      const relevant = check.choices[0]?.message?.content?.trim().toLowerCase() === "yes";
      return { ...r, hybrid: hybridScore, relevant, sem: semScore, lex: lexical };
    })
  );

  const filtered = hybrid.filter((r) => r.relevant).sort((a, b) => b.hybrid - a.hybrid);
  return { contextual: filtered[0] || null, top: filtered };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) throw new Error("No file uploaded.");

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    let text = "";
    if (file.name.toLowerCase().endsWith(".pdf")) text = await extractTextFromPDF(file);
    else text = Buffer.from(await file.arrayBuffer()).toString("utf8");

    const detect = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Classify: 'general' for RFP docs, 'questionnaire' only if it's mostly blank prompts/questions.",
        },
        { role: "user", content: text.slice(0, 4000) },
      ],
    });

    const docType = detect.choices[0]?.message?.content?.includes("questionnaire")
      ? "questionnaire"
      : "general";

    const extractQs = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: "Extract only distinct, well-formed RFP questions." },
        { role: "user", content: text.slice(0, 12000) },
      ],
    });

    const questions =
      extractQs.choices[0]?.message?.content?.split(/\n+/).map(norm).filter(Boolean).slice(0, 60) ||
      [];

    const answers: any[] = [];
    const unanswered: string[] = [];

    for (const q of questions) {
      const { contextual, top } = await matchFromKB(supabase, openai, q);
      if (!contextual) unanswered.push(q);
      else answers.push({ q, best: contextual, top });
    }

    const aiDerived = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.5,
      messages: [
        { role: "system", content: "Provide final synthesized answers using all context and RFP text." },
        { role: "user", content: `Questions: ${questions.join("\n")}\nText:\n${text.slice(0, 8000)}` },
      ],
    });

    const doc = new docx.Document({
      styles: {
        paragraphStyles: [
          { id: "Normal", name: "Normal", run: { font: "Arial", size: 22 } },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            run: { size: 30, bold: true },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            run: { size: 26, bold: true },
          },
        ],
      },
      sections: [
        {
          properties: {},
          children: [
            new docx.Paragraph({ text: "RFP AI Report", style: "Heading1" }),
            new docx.Paragraph({ text: `Document Type: ${docType}`, spacing: { after: 400 } }),
            new docx.Paragraph({ text: "AI-Derived Summary", style: "Heading2" }),
            new docx.Paragraph({
              text: norm(aiDerived.choices[0]?.message?.content || ""),
              spacing: { after: 400 },
            }),
            new docx.Paragraph({ text: "Contextual Matches", style: "Heading2" }),
            ...answers.flatMap((a) => [
              new docx.Paragraph({ text: a.q, style: "Heading2" }),
              new docx.Paragraph({ text: a.best.a, spacing: { after: 300 } }),
              new docx.Paragraph({
                text: `Source: ${a.best.source} | Scores (hybrid/sem/lex): ${a.best.hybrid.toFixed(
                  2
                )}/${a.best.sem.toFixed(2)}/${a.best.lex.toFixed(2)}`,
                spacing: { after: 400 },
              }),
            ]),
            new docx.Paragraph({ text: "Unanswered Questions", style: "Heading2" }),
            ...unanswered.map((q) =>
              new docx.Paragraph({ text: q, spacing: { after: 200 } })
            ),
          ],
        },
      ],
    });

    const buffer = await docx.Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);
    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="RFP_Report_${Date.now()}.docx"`,
      },
    });
  } catch (err: any) {
    console.error("[generate-report] ❌", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

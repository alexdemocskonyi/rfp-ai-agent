import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as docx from "docx";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function matchFromKB(q: string) {
  const EMB_MODEL = "text-embedding-3-large";
  const emb = await openai.embeddings.create({ model: EMB_MODEL, input: q });
  const qvec = emb.data[0].embedding;

  const { data: sem } = await supabase.rpc("match_kb_items", {
    query_embedding: qvec,
    match_count: 50,
  });

  const ids = (sem || []).map((r: any) => r.id);
  if (!ids.length) return { contextual: [], top: [] };

  const { data: rows } = await supabase
    .from("kb_items")
    .select("id,q,a,source")
    .in("id", ids);

  // Compute hybrid score + dedupe similar answers
  const candidates = (rows || []).map((r) => {
    const semScore = sem.find((s: any) => s.id === r.id)?.score || 0;
    const lex = (r.q + r.a).toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.5;
    return { ...r, score: 0.65 * semScore + 0.35 * lex };
  });

  // Filter duplicates by normalized text
  const unique: any[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const nearDup = unique.find((u) => u.a?.slice(0, 200) === c.a?.slice(0, 200));
    if (!nearDup) unique.push(c);
  }

  // Keep top unique results
  const top = unique.slice(0, 8);

  // GPT verifies which are actually relevant
  const verifyPrompt =
    `You are filtering RFP knowledge base matches.\n\n` +
    `Question: "${q}"\n\n` +
    `Candidate Answers:\n` +
    top
      .map(
        (r, i) =>
          `${i + 1}. [${r.source || "unknown"}] Q: ${r.q}\nA: ${r.a?.slice(0, 800)}\n`
      )
      .join("\n") +
    `\n\nReturn a JSON array of the indexes (1-based) of answers that actually respond to the question contextually.`;

  const review = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: verifyPrompt }],
    response_format: { type: "json_object" },
  });

  let keepIdx: number[] = [];
  try {
    keepIdx = JSON.parse(review.choices[0].message.content || "{}").relevant || [];
  } catch {
    keepIdx = [1, 2, 3];
  }

  const contextual = keepIdx
    .map((i) => top[i - 1])
    .filter(Boolean)
    .slice(0, 3);

  return { contextual, top };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    const filename = file?.name || "input";
    const buf = Buffer.from(await file.arrayBuffer());
    const text = buf.toString("utf-8");

    const questions = text
      .split(/\n+/)
      .filter((l) => l.match(/\?$/) || l.length > 40)
      .slice(0, 30);

    const docSections: docx.Paragraph[] = [];
    for (const q of questions) {
      const { contextual, top } = await matchFromKB(q);

      // AI-derived synthesis
      const synth = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Using the following knowledge base items, synthesize a coherent answer.\n\nQuestion: ${q}\n\nContext:\n${contextual
              .map((r) => r.a)
              .join("\n\n")}`,
          },
        ],
      });

      const aiAnswer = synth.choices[0].message.content?.trim() || "No answer.";

      docSections.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: `Q: ${q}`, bold: true })],
        }),
        new docx.Paragraph({
          text: `Contextual Matches (${contextual.length})`,
          spacing: { after: 100 },
        }),
        ...contextual.map(
          (r) =>
            new docx.Paragraph({
              text: `- ${r.a}\n(Source: ${r.source})`,
              spacing: { after: 80 },
            })
        ),
        new docx.Paragraph({
          children: [new docx.TextRun({ text: `AI-Derived Answer`, bold: true })],
        }),
        new docx.Paragraph({ text: aiAnswer, spacing: { after: 200 } })
      );
    }

    const doc = new docx.Document({
      sections: [{ children: docSections }],
    });
    const buffer = await docx.Packer.toBuffer(doc);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="RFP_Report_${Date.now()}.docx"`,
      },
    });
  } catch (e: any) {
    console.error("generate-report error:", e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}

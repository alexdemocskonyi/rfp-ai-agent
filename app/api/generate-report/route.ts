import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as docx from "docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractQuestions(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.filter(l =>
    /(\?$|^[-*•\d]+\.)/.test(l) ||
    l.toLowerCase().startsWith("describe") ||
    l.toLowerCase().startsWith("how ") ||
    l.toLowerCase().startsWith("what ")
  );
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let buf: Buffer;
    let filename = "uploaded.pdf";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (!body.fileUrl) throw new Error("Missing fileUrl");
      const res = await fetch(body.fileUrl);
      if (!res.ok) throw new Error("Failed to fetch from fileUrl");
      buf = Buffer.from(await res.arrayBuffer());
      filename = body.fileUrl.split("/").pop() || filename;
    } else {
      const form = await req.formData();
      const file = form.get("file") as File;
      buf = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    }

    const text = buf.toString("utf8").slice(0, 25000);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const questions = extractQuestions(text);
    const answers: { q: string; a: string; src: string }[] = [];

    for (const q of questions.slice(0, 50)) {
      const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: q });
      const qvec = emb.data[0].embedding;
      const { data } = await supabase.rpc("match_kb_items", { query_embedding: qvec, match_count: 10 });
      const ids = (data || []).map((r: any) => r.id);
      const { data: rows } = await supabase.from("kb_items").select("q,a,source").in("id", ids);
      if (!rows?.length) continue;

      const packed = rows.map((r: any, i: number) => `[#${i + 1}] Q: ${r.q}\nA: ${r.a}`).join("\n\n");
      const cmp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Select the best answer from candidates or reply 'none'." },
          { role: "user", content: `Question: ${q}\n\nCandidates:\n${packed}` },
        ],
      });
      const a = norm(cmp.choices[0]?.message?.content || "");
      if (a && a.toLowerCase() !== "none") answers.push({ q, a, src: rows[0].source || "kb_items" });
    }

    const doc = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({ text: `RFP Report for ${filename}`, heading: docx.HeadingLevel.HEADING_1 }),
          ...answers.flatMap(a => [
            new docx.Paragraph({ children: [ new docx.TextRun({ text: `Q: ${a.q}`, bold: true }) ] }),
            new docx.Paragraph({ text: `A: ${a.a}` }),
            new docx.Paragraph({ text: `Source: ${a.src}`, spacing: { after: 200 } }),
          ]),
        ]
      }]
    });

    const buffer = await docx.Packer.toBuffer(doc);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="RFP_Report_${Date.now()}.docx"`,
      },
    });

  } catch (e: any) {
    console.error("generate-report error:", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

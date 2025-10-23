import { NextResponse } from "next/server";
import { loadKB } from "@/lib/storage";
import * as docx from "docx";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const kb = await loadKB();
    const items = (kb?.items || []).filter((i: any) => i?.Q || i?.question);
    console.log("🧩 Loaded KB items:", items.length);

    if (!items.length)
      return NextResponse.json({ error: "No KB entries" }, { status: 400 });

    const children: docx.Paragraph[] = [];
    const doc = new docx.Document({ sections: [{ children }] });

    children.push(
      new docx.Paragraph({ text: "RFP AI Report", heading: docx.HeadingLevel.TITLE })
    );
    children.push(
      new docx.Paragraph({
        text: `Generated: ${new Date().toLocaleString()}`,
        spacing: { after: 300 },
      })
    );

    // Add at least the first 10 Q/A pairs
    for (const qa of items.slice(0, 10)) {
      const q = (qa as any).Q || (qa as any).question || "(no question)";
      const a = (qa as any).A || (qa as any).answer || "(no stored answer)";
      console.log("📄 Adding:", q.substring(0, 40));

      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: "Question:", bold: true })],
        })
      );
      children.push(new docx.Paragraph({ text: q }));
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: "Answer:", bold: true })],
        })
      );
      children.push(new docx.Paragraph({ text: a }));
      children.push(
        new docx.Paragraph({
          text: "──────────────────────────────",
          spacing: { before: 300, after: 300 },
        })
      );
    }

    const buffer = await docx.Packer.toBuffer(doc);
    const uint8 = new Uint8Array(buffer);
    const blob = new Blob([uint8], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    return new Response(blob, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": "attachment; filename=RFP_Report.docx",
      },
    });
  } catch (e: any) {
    console.error("❌ Report generation error:", e);
    return NextResponse.json({ error: e?.message || e }, { status: 500 });
  }
}

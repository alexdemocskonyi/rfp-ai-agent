import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const {
      title = "",
      audience = "",
      purpose = "",
      outline = "",
      tone = "professional",
      length = "medium",
      format = "proposal", // proposal | sow | memo | email | one-pager
    } = body || {};

    const sys =
      "You produce clean, executive-ready Markdown for RFP responses / SOWs / memos. " +
      "Return ONLY Markdown (no code fences). Use clear headings (H1–H3), numbered sections, " +
      "tight bullets, and tables when helpful. Prefer action-oriented, concrete language. " +
      "Mark any missing facts with [TBD].";

    const user =
      `Format: ${format}\nTitle: ${title}\nAudience: ${audience}\nPurpose: ${purpose}\n` +
      `Tone: ${tone}\nLength: ${length}\n\n` +
      (outline ? `Outline (optional):\n${outline}\n\n` : "") +
      "Generate the document now in Markdown.";

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

    const comp = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const markdown = comp.choices[0]?.message?.content?.trim() || "";
    return NextResponse.json({ ok: true, markdown });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

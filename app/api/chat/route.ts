import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const { messages = [] } = await req.json();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // Last user turn (used for retrieval)
    const userText =
      (messages as Msg[]).filter(m => m.role === "user").slice(-1)[0]?.content?.slice(0, 2000) || "";

    // Try to pull context from your existing /api/search (graceful if it fails)
    let context = "";
    try {
      const base = new URL(req.url).origin;
      const r = await fetch(base + "/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: userText, k: 6 }),
      });
      const js = await r.json().catch(() => null);
      const rows =
        (js?.chunks ?? js?.results ?? js?.matches ?? [])
          .map((x: any) => x.content || x.text || x.chunk || "")
          .filter(Boolean);
      context = rows.join("\n---\n").slice(0, 12000);
    } catch {}

    const sys =
      "You are RFP AI — a KB expert and smart maintainer. Be concise, precise, and cite gaps. " +
      "If unsure, say so and suggest what to ingest. When helpful, propose KB additions as bullets. " +
      (context ? "\n\nKB context follows (use if relevant):\n" + context : "");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [{ role: "system", content: sys }, ...messages],
    });

    const text = completion.choices[0]?.message?.content || "Sorry — no reply generated.";
    return NextResponse.json({ ok: true, message: text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

function norm(t: string) { return (t || "").replace(/\s+/g, " ").trim(); }

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const q = norm(messages?.slice(-1)[0]?.content || "");
    if (!q) return NextResponse.json({ ok: false, error: "Empty query" }, { status: 400 });

    // Semantic match
    const emb = await openai.embeddings.create({ model: EMB_MODEL, input: q });
    const qvec = emb.data[0].embedding;
    const { data: sim } = await supabase.rpc("match_kb_items", { query_embedding: qvec, match_count: 40 });
    if (!sim?.length) return NextResponse.json({ ok: true, message: "(no semantic matches found)" });

    const ids = sim.map((r: any) => r.id);
    const { data: rows } = await supabase.from("kb_items").select("id,q,a,source").in("id", ids);
    const safeRows = Array.isArray(rows) ? rows : [];
    const byId = Object.fromEntries(safeRows.map(r => [r.id, r]));

    const ranked = sim
      .map((r: any) => ({ ...byId[r.id], id: r.id, score: r.score }))
      .filter((r: any) => r?.a?.trim()?.length > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 6);

    const context = ranked.map((r: any, i: number) => `[${i+1}] Q: ${r.q}\nA: ${r.a}`).join("\n\n");

    const chat = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are an RFP analyst. You must answer precisely using the provided context only. " +
            "Never repeat the same answer. Always adapt phrasing to the question. If context is insufficient, say so clearly."
        },
        { role: "user", content: `Question: ${q}\n\nRelevant KB:\n${context}` }
      ]
    });

    const ai = norm(chat.choices[0]?.message?.content || "");
    const message = [
      "### Context",
      ranked.map((r: any, i: number) => `${i+1}. ${r.a.slice(0,180)}...`).join("\n"),
      "\n---\n",
      "### AI-Derived Answer",
      ai
    ].join("\n");

    return NextResponse.json({ ok: true, message, ai, contextual: ranked });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

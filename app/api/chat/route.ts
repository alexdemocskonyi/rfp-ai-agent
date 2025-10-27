import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

type KBRow = { id: string; q: string | null; a: string | null; source: string | null };
type Ranked = KBRow & { sem: number; lex: number; hybrid: number };

const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const tokenize = (s: string) =>
  norm(s.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

async function hybridMatch(openai: OpenAI, supabase: any, question: string): Promise<{ best: Ranked | null; top: Ranked[] }> {
  // semantic
  const emb = await openai.embeddings.create({ model: EMB_MODEL, input: question });
  const qvec = emb.data[0].embedding;

  let sem: Array<{ id: string; score: number }> = [];
  try {
    const { data } = await supabase.rpc("match_kb_items", { query_embedding: qvec, match_count: 40 } as any);
    sem = Array.isArray(data) ? data : [];
  } catch {
    sem = [];
  }
  const ids = sem.map((x) => x.id);
  if (!ids.length) return { best: null, top: [] };

  // fetch candidates
  const { data: rows } = await supabase.from("kb_items").select("id,q,a,source").in("id", ids);
  const arr: KBRow[] = Array.isArray(rows) ? (rows as KBRow[]) : [];

  // lexical + hybrid
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

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json({ ok: false, error: "Missing server envs" }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const body = await req.json().catch(() => ({}));
    const q = norm(body?.q || "");
    if (!q || q.length < 2) return NextResponse.json({ ok: false, error: "Missing q" }, { status: 400 });

    const { best, top } = await hybridMatch(openai, supabase as any, q);

    // If we have a strong contextual hit, return it plus a tiny raw excerpt
    if (best && best.hybrid >= 0.42) {
      const excerpt = norm((best.a || "").slice(0, 800));
      return NextResponse.json({
        ok: true,
        contextual: {
          answer: best.a,
          source: best.source || "kb_items",
          scores: { hybrid: best.hybrid, sem: best.sem, lex: best.lex },
        },
        raw: excerpt ? { source: best.source || "kb_items", excerpt } : null,
        ai: null,
        top: top.map((t) => ({
          id: t.id,
          source: t.source,
          scores: { hybrid: t.hybrid, sem: t.sem, lex: t.lex },
          q: t.q,
        })),
      });
    }

    // Otherwise, fall back to an AI synthesized answer from the best available context
    const contextBlock = top
      .map(
        (t, i) =>
          `[#${i + 1}] Q: ${norm(t.q || "")}\nA: ${norm(t.a || "")}\n(src: ${t.source || "kb_items"}; hybrid=${t.hybrid.toFixed(
            3
          )}; sem=${t.sem.toFixed(3)}; lex=${t.lex.toFixed(3)})`
      )
      .join("\n\n");

    const ai = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "Answer the user's question using the provided context. If missing, say you don't have that detail and provide the closest policy/process info. Be concise and specific.",
        },
        { role: "user", content: `Question: ${q}` },
        { role: "user", content: `Context:\n${contextBlock || "(none)"}` },
      ],
    });

    const aiAnswer = norm(ai.choices[0]?.message?.content || "");

    return NextResponse.json({
      ok: true,
      contextual: null,
      raw: null,
      ai: aiAnswer || null,
      top: top.map((t) => ({
        id: t.id,
        source: t.source,
        scores: { hybrid: t.hybrid, sem: t.sem, lex: t.lex },
        q: t.q,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

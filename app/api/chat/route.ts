// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMB_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

function assertEnv() {
  if (!/^https?:\/\//i.test(SUPABASE_URL))
    throw new Error("Missing/invalid NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_KEY) throw new Error("Missing Supabase key");
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
}

const MIN_ANSWER_LEN = 40;

function norm(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function lc(s: string) {
  return norm(s).toLowerCase();
}
function hasAny(hay: string, needles: string[]) {
  const H = lc(hay);
  return needles.some((n) => H.includes(n));
}

const OFF_TOPIC_TERMS = [
  "condition management",
  "disease management",
  "health coach",
  "coaches",
  "coaching",
  "resilience",
  "resilience training",
  "life stress",
  "stress coaching",
  "pain coaching",
  "prochaska",
  "stages of change",
  "motivational interviewing",
  "peer support",
  "wellness",
];

export async function POST(req: Request) {
  try {
    assertEnv();

    const body = (await req.json()) as { messages: Msg[] };
    const lastUser = [...(body.messages || [])]
      .reverse()
      .find((m) => m.role === "user");
    const question = norm(lastUser?.content || "");
    if (!question)
      return NextResponse.json(
        { ok: false, error: "Empty question" },
        { status: 400 }
      );

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // ---------------------------------------------------
    // 1) Semantic candidates via match_kb_items RPC
    // ---------------------------------------------------
    let semCands: Array<{ id: string; score: number }> = [];
    try {
      const emb = await openai.embeddings.create({
        model: EMB_MODEL,
        input: question,
      });
      const qvec = emb.data?.[0]?.embedding as number[] | undefined;
      if (qvec?.length) {
        const { data } = await supabase
          .rpc("match_kb_items", {
            query_embedding: qvec,
            match_count: 40,
          })
          .returns<{ id: string; score: number }[]>();
        semCands = Array.isArray(data)
          ? data.map((r) => ({ id: r.id, score: r.score }))
          : [];
      }
    } catch {
      semCands = [];
    }

    // ---------------------------------------------------
    // 2) Lexical candidates via FTS RPC (safe fallback)
    // ---------------------------------------------------
    const { data: qRows } =
      (await supabase.rpc("search_kb_items", { q: question, lim: 60 })) || {};
    const { data: aRows } =
      (await supabase.rpc("search_kb_answers", { q: question, lim: 60 })) || {};

    const ftsCombined: any[] = [
      ...(Array.isArray(qRows) ? qRows : []),
      ...(Array.isArray(aRows) ? aRows : []),
    ];

    const lexCands = new Map<string, number>();
    for (const r of ftsCombined) {
      if (!r?.id) continue;
      const prev = lexCands.get(r.id) || 0;
      lexCands.set(r.id, Math.max(prev, Number(r.rank) || 0));
    }

    // ---------------------------------------------------
    // 3) Gather all candidate items
    // ---------------------------------------------------
    const candIds = Array.from(
      new Set([...semCands.map((c) => c.id), ...Array.from(lexCands.keys())])
    );
    let items: { id: string; q: string; a: string; source: string | null }[] =
      [];
    if (candIds.length) {
      const { data } = await supabase
        .from("kb_items")
        .select("id,q,a,source")
        .in("id", candIds)
        .limit(120);
      items = (data || []) as any[];
    }

    // ---------------------------------------------------
    // 4) Hybrid scoring (semantic + lexical + quality)
    // ---------------------------------------------------
    const semMap = new Map(semCands.map((c) => [c.id, c.score]));
    const maxLex = Math.max(0, ...Array.from(lexCands.values()));

    const results = items.map((r) => {
      const atext = norm(r.a || "");
      const semScore = semMap.get(r.id) || 0;
      const lexScore = maxLex
        ? (lexCands.get(r.id) || 0) / maxLex
        : 0;
      let quality = 0;
      if (atext.length > 300) quality += 0.15;
      if (/[•\-]\s|\n\d+\.\s/.test(atext)) quality += 0.1;
      let penalty = 0;
      if (hasAny(`${r.q} ${r.a}`, OFF_TOPIC_TERMS)) penalty -= 0.25;
      const hybrid = 0.65 * semScore + 0.35 * lexScore + quality + penalty;
      return { ...r, atext, hybrid, semScore, lexScore };
    });

    const qaRows = results
      .filter((r) => r.atext.length >= MIN_ANSWER_LEN)
      .sort((a, b) => b.hybrid - a.hybrid)
      .slice(0, 12);

    const contextual = qaRows[0] || null;

    // ---------------------------------------------------
    // 5) Raw-text chunks as contextual contrast
    // ---------------------------------------------------
    const chunks = await supabase
      .from("kb_chunks")
      .select("content,item_id")
      .textSearch("content", question as any, {
        type: "websearch",
        config: "english",
      })
      .limit(8);
    const ctxChunks = chunks.data || [];
    let chunkSource = "";
    if (ctxChunks.length) {
      const ids = Array.from(new Set(ctxChunks.map((c: any) => c.item_id)));
      const items2 =
        (await supabase
          .from("kb_items")
          .select("id,source")
          .in("id", ids)).data || [];
      const map = new Map(
        items2.map((i) => [i.id, i.source || `kb_items:${i.id}`])
      );
      chunkSource = map.get(ctxChunks[0].item_id) || "kb_chunks";
    }
    const rawText = norm(ctxChunks[0]?.content || "");

    // ---------------------------------------------------
    // 6) AI-derived synthesis (blend of Q&A + chunks)
    // ---------------------------------------------------
    const qaForBlend = qaRows
      .slice(0, 6)
      .map((r, i) => `[#Q${i + 1}] Q: ${r.q}\nA: ${r.atext}`)
      .join("\n\n");
    const ctxForBlend = ctxChunks
      .slice(0, 6)
      .map((c: any, i: number) => `[#C${i + 1}] ${c.content}`)
      .join("\n\n");

    const blendPrompt = [
      "You are RFP AI. Combine the provided Q&A and context to generate the best possible direct answer.",
      "Prefer exact phrasing from Q&A when clearly relevant.",
      "Be concise, professional, and fact-based. Do not editorialize.",
      "",
      `USER QUESTION:\n${question}`,
      "",
      `Q&A CANDIDATES:\n${qaForBlend || "(none)"}`,
      "",
      `CONTEXT CHUNKS:\n${ctxForBlend || "(none)"}`,
    ].join("\n");

    const blend = await (qaForBlend || ctxForBlend
      ? openai.chat.completions.create({
          model: CHAT_MODEL,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content:
                "You are an RFP analyst. Respond using only the facts from provided materials.",
            },
            { role: "user", content: blendPrompt },
          ],
        })
      : Promise.resolve({ choices: [{ message: { content: "" } }] } as any));

    const aiDerived = norm(blend.choices[0]?.message?.content || "");

    // ---------------------------------------------------
    // 7) Compose triple answer output
    // ---------------------------------------------------
    const src = (s: string | null | undefined, fb: string) =>
      (s && s.trim()) || fb;

    const ctxSection = contextual
      ? [
          "### Contextual (Q&A)",
          contextual.atext,
          `_Source: ${src(contextual.source, `kb_items:${contextual.id}`)}_`,
        ].join("\n\n")
      : "### Contextual (Q&A)\nNo close Q&A match found.";

    const rawSection = rawText
      ? [
          "### Raw Text Excerpt",
          rawText.length > 900 ? rawText.slice(0, 900) + "…" : rawText,
          `_Source: ${src(chunkSource, "kb_chunks")}_`,
        ].join("\n\n")
      : "### Raw Text Excerpt\nNo strong raw-text match found.";

    const aiSection = aiDerived
      ? ["### AI-Derived (Synthesized Answer)", aiDerived].join("\n\n")
      : "### AI-Derived (Synthesized Answer)\n(nothing generated)";

    const message = [ctxSection, rawSection, aiSection].join("\n\n---\n\n");

    return NextResponse.json({
      ok: true,
      mode: "triple",
      retrievedQA: qaRows.length,
      retrievedCtx: ctxChunks.length,
      message,
      debug: {
        semantic: semCands.length > 0,
        topQA: qaRows.slice(0, 3).map((r) => ({
          id: r.id,
          src: r.source,
          hybrid: Number(r.hybrid.toFixed(3)),
          sem: Number(r.semScore.toFixed(3)),
          lex: Number(r.lexScore.toFixed(3)),
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST() {
  try {
    let totalUpdated = 0;
    const BATCH_SIZE = 20;
    let tries = 0;

    while (true) {
      // Fetch up to 20 rows needing embeddings
      const { data, error } = await supabase
        .from("rfp_kb")
        .select("id, question, answer, text, embedding")
        .is("embedding", null)
        .limit(BATCH_SIZE);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        const content = (row.question || row.answer || row.text || "").trim();
        if (!content) continue;

        try {
          const emb = await openai.embeddings.create({
            model: "text-embedding-3-large",
            input: content,
          });

          const vector = emb.data[0].embedding;

          const { error: upErr } = await supabase
            .from("rfp_kb")
            .update({ embedding: vector })
            .eq("id", row.id);

          if (!upErr) totalUpdated++;
          else console.error(`❌ Failed to update embedding for row ${row.id}:`, upErr.message);
        } catch (e: any) {
          console.error(`⚠️ Embedding failed for row ${row.id}:`, e.message);
          if (e.message.includes("rate limit")) {
            // Back off and retry current batch
            tries++;
            if (tries > 5) throw new Error("Too many rate limit retries");
            await new Promise((r) => setTimeout(r, 2000 * tries));
            continue;
          }
        }
      }
    }

    return NextResponse.json({ ok: true, updated: totalUpdated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Embed failed" }, { status: 500 });
  }
}

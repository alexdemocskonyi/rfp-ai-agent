import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-large"; // 3072-dim
const PAGE_SIZE = 1000; // DB rows per page
const BATCH = 200;      // rows per embeddings.create call

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embedBatch(inputs) {
  let attempt = 0;
  for (;;) {
    try {
      return await openai.embeddings.create({ model: EMB_MODEL, input: inputs });
    } catch (e) {
      const status = e?.status || e?.code || 0;
      if (status === 401) {
        console.error("❌ OpenAI 401: Invalid API key. Update OPENAI_API_KEY in .env.local with the real, unmasked key.");
        throw e;
      }
      if (status === 429 || status >= 500) {
        attempt++;
        const wait = Math.min(1000 * Math.pow(2, attempt), 20000);
        console.warn(`⚠️ OpenAI error (${status}). Retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function countRows() {
  const { count, error } = await supabase.from("kb_items").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

async function fetchPage(offset, limit) {
  const { data, error } = await supabase
    .from("kb_items")
    .select("id,q,a")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}

async function updateEmbedding(id, vec) {
  const { error } = await supabase.from("kb_items").update({ embedding: vec }).eq("id", id);
  if (error) throw error;
}

(async () => {
  console.log(`🔧 Model: ${EMB_MODEL}`);
  const total = await countRows();
  console.log(`📦 Total kb_items: ${total}`);
  if (!total) { console.log("❌ No KB items found"); process.exit(0); }

  let processed = 0;
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const pageIndex = Math.floor(offset / PAGE_SIZE) + 1;
    const pages = Math.ceil(total / PAGE_SIZE);
    const page = await fetchPage(offset, PAGE_SIZE);
    console.log(`\n📄 Page ${pageIndex}/${pages} (rows: ${page.length})`);

    for (let i = 0; i < page.length; i += BATCH) {
      const chunk = page.slice(i, i + BATCH);
      const inputs = chunk.map(r => [r.q, r.a].filter(Boolean).join(" ").slice(0, 8000));
      const emb = await embedBatch(inputs);
      for (let j = 0; j < chunk.length; j++) {
        await updateEmbedding(chunk[j].id, emb.data[j].embedding);
      }
      processed += chunk.length;
      console.log(`✅ Embedded ${processed}/${total}`);
    }
  }
  console.log("\n🎯 All embeddings refreshed");
})();

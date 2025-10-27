import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const s = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
                       process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const EMB = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
const K   = Number(process.env.MATCH_K || 200);          // candidate pool from SQL
const TOP = Number(process.env.TOP_N || 8);               // final results
const FLOOR = Number(process.env.SCORE_FLOOR || 0.48);    // hide weak hits

const norm = t => (t||'').toLowerCase();

function diverseBySource(rows, maxPerSource=3) {
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    const src = r.source || '∅';
    const n = seen.get(src) || 0;
    if (n < maxPerSource) { out.push(r); seen.set(src, n+1); }
    if (out.length >= TOP) break;
  }
  return out;
}

async function search(q) {
  // 1) Embed query
  const e = await openai.embeddings.create({ model: EMB, input: q });
  const qvec = e.data[0].embedding;

  // 2) Get semantic neighbors (big pool)
  const { data: sim, error: rpcErr } = await s.rpc('match_kb_items', {
    query_embedding: qvec,
    match_count: K
  });
  if (rpcErr) throw rpcErr;

  const ids = (sim||[]).map(r => r.id);
  if (!ids.length) return [];

  // 3) Fetch fields; enforce "no empty answers" on the app side
  const { data: rows, error: selErr } = await s
    .from('kb_items')
    .select('id,q,a,source')
    .in('id', ids);
  if (selErr) throw selErr;

  const byId = Object.fromEntries(rows.map(r => [r.id, r]));

  // 4) Hybrid rerank (semantic + tiny lexical)
  const hy = (sim||[])
    .map(r => {
      const row = byId[r.id] || {};
      const text = (row.q||'') + ' ' + (row.a||'');
      const sem  = Number(r.score) || 0;
      const lex  = norm(text).includes(norm(q)) ? 1 : 0.4;   // small bump
      const hasAnswer = (row.a || '').trim().length > 0;     // enforce answer present
      return { ...row, id:r.id, sem, lex, hybrid: 0.6*sem + 0.4*lex, hasAnswer };
    })
    .filter(r => r.hasAnswer && r.sem >= FLOOR)
    .sort((a,b) => b.hybrid - a.hybrid);

  // 5) Source diversity, take top
  return diverseBySource(hy, 3).slice(0, TOP);
}

(async () => {
  const qs = process.argv.slice(2);
  if (!qs.length) {
    console.log('Usage: node quick-match.mjs "question 1" "question 2" ...');
    process.exit(0);
  }
  for (const q of qs) {
    const hits = await search(q);
    console.log(`\nQ: ${q}`);
    if (!hits.length) { console.log('  (no strong matches)\n'); continue; }
    hits.forEach((r,i) => {
      const blurb = (r.a || r.q || '').replace(/\s+/g,' ').slice(0,140) + ((r.a||'').length>140?'…':'');
      console.log(`${i+1}. h=${r.hybrid.toFixed(4)}  s=${r.sem.toFixed(4)}  ${blurb}  [${r.source||r.id}]`);
    });
  }
})();

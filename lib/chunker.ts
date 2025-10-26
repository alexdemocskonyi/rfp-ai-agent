// lib/chunker.ts
// Simple, robust character-based chunker with overlap.
// Tunable via CHUNK_CHARS and CHUNK_OVERLAP env vars.

const DEFAULT_SIZE = Number(process.env.CHUNK_CHARS || 1200);   // ~300 tokens @ 4 chars/token
const DEFAULT_OVERLAP = Number(process.env.CHUNK_OVERLAP || 200);

function clean(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

export type MadeChunk = { ord: number; content: string; token_count: number };

export function makeChunks(
  text: string,
  size: number = DEFAULT_SIZE,
  overlap: number = DEFAULT_OVERLAP
): MadeChunk[] {
  const t = clean(text);
  if (!t) return [];
  const out: MadeChunk[] = [];
  let start = 0, ord = 0;
  const step = Math.max(1, size - Math.max(0, overlap));
  while (start < t.length) {
    const end = Math.min(t.length, start + size);
    const slice = t.slice(start, end);
    const tokenCount = Math.ceil(slice.length / 4); // rough, fast estimate
    out.push({ ord, content: slice, token_count: tokenCount });
    ord += 1;
    start += step;
  }
  return out;
}

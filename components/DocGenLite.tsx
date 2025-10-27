"use client";

import { useState } from "react";

export default function DocGenLite() {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [outline, setOutline] = useState("");
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("medium");
  const [format, setFormat] = useState("proposal");
  const [busy, setBusy] = useState(false);
  const [md, setMd] = useState("");

  async function generate() {
    setBusy(true);
    setMd("");
    try {
      const res = await fetch("/api/generate-doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, audience, purpose, outline, tone, length, format }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Generation failed");
      setMd(data.markdown || "");
    } catch (e: any) {
      setMd("Error: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([md || ""], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (title || "document") + ".md";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)}
               style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }} />
        <input placeholder="Audience" value={audience} onChange={e=>setAudience(e.target.value)}
               style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }} />
        <input placeholder="Purpose" value={purpose} onChange={e=>setPurpose(e.target.value)}
               style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={format} onChange={e=>setFormat(e.target.value)}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
            <option value="proposal">Proposal</option>
            <option value="sow">SOW</option>
            <option value="memo">Memo</option>
            <option value="email">Email</option>
            <option value="one-pager">One-pager</option>
          </select>
          <select value={tone} onChange={e=>setTone(e.target.value)}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
            <option>professional</option>
            <option>concise</option>
            <option>persuasive</option>
            <option>friendly</option>
          </select>
          <select value={length} onChange={e=>setLength(e.target.value)}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
            <option>short</option>
            <option>medium</option>
            <option>long</option>
          </select>
        </div>
      </div>

      <textarea placeholder="Optional outline (one section per line)…"
                rows={4}
                value={outline}
                onChange={e=>setOutline(e.target.value)}
                style={{ marginTop: 10, width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }} />

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button onClick={generate} disabled={busy}
                style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: "#10b981", color: "#fff", padding: "8px 10px", fontWeight: 600 }}>
          {busy ? "Generating…" : "Generate"}
        </button>
        <button onClick={download} disabled={!md}
                style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: md ? "#0ea5e9" : "#f3f4f6", color: md ? "#fff" : "#6b7280", padding: "8px 10px", fontWeight: 600 }}>
          Download .md
        </button>
      </div>

      <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, Monaco", fontSize: 13 }}>
        {md || "Your Markdown preview will appear here."}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type KBStats = {
  total: number;
  contextChunks: number;
  lastUpdated: string | null;
  withAnswers?: number;
  qaWithAnswers?: number;
  latestBatchId?: string | null;
};

export default function Home() {
  const [stats, setStats] = useState<KBStats>({
    total: 0, contextChunks: 0, lastUpdated: null,
    withAnswers: 0, qaWithAnswers: 0, latestBatchId: null
  });
  const [busy, setBusy] = useState(false);
  const [chatQ, setChatQ] = useState("");
  const [chatA, setChatA] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

    async function refreshStats() {
      try {
        const r = await fetch("/api/kb-count", { cache: "no-store" });
        const j = await r.json();

        // Normalize all field names so UI always updates correctly
        setStats({
          total: j.total ?? j.count ?? 0,
          contextChunks: j.contextChunks ?? j.count ?? 0,
          lastUpdated: j.lastUpdated ?? j.updatedAt ?? null,
          withAnswers: j.withAnswers ?? j.qaWithAnswers ?? 0,
          qaWithAnswers: j.qaWithAnswers ?? j.withAnswers ?? 0,
          latestBatchId: j.latestBatchId ?? null,
        });

        console.log("📊 KB Stats loaded:", j);
      } catch (e: any) {
        console.error("Failed to refresh stats:", e);
        setStats({
          total: 0,
          contextChunks: 0,
          lastUpdated: null,
          withAnswers: 0,
          qaWithAnswers: 0,
          latestBatchId: null,
        });
      }
    }

    useEffect(() => {
      refreshStats();
    }, []);

  async function handleUpload() {
    const f = fileRef.current?.files?.[0];
    if (!f || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("files", f);
      const r = await fetch("/api/ingest", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      alert(`Uploaded ${j.uploaded} Q&A`);
      await refreshStats();
    } catch (e: any) {
      alert("Upload error: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    try {
      const r = await fetch("/api/generate-report", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "RFP_Report.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Generate error: " + (e?.message || e));
    }
  }

  async function handleChat() {
    if (!chatQ.trim()) return;
    setChatA("Thinking...");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: chatQ })
      });
      const j = await r.json();
      setChatA(j.answer || "(no answer)");
    } catch (e: any) {
      setChatA("Error: " + (e?.message || e));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1>RFP AI Agent</h1>
      <p>✅ Local + Vercel Ready</p>

      <section>
        <h3>KB Stats</h3>
        <ul>
          <li>Total items: {stats.total}</li>
          <li>Questions with answers: {(stats.qaWithAnswers ?? stats.withAnswers ?? 0)}</li>
          <li>Context chunks: {stats.contextChunks}</li>
          <li>Last updated: {stats.lastUpdated || "-"}</li>
          <li>Latest upload batch: {stats.latestBatchId ?? "-"}</li>
        </ul>
      </section>

      <section>
        <h3>Upload & Ingest</h3>
        <input ref={fileRef} type="file" />
        <button onClick={handleUpload} disabled={busy} style={{ marginLeft: 8 }}>
          {busy ? "Uploading…" : "Upload & Index"}
        </button>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Chat</h3>
        <input
          value={chatQ}
          onChange={(e) => setChatQ(e.target.value)}
          placeholder="Ask a question about your KB..."
          style={{ width: "70%" }}
        />
        <button onClick={handleChat} style={{ marginLeft: 8 }}>Chat</button>
        {chatA && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{chatA}</p>}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Generate Report (.docx)</h3>
        <button onClick={handleGenerate}>Generate DOCX Report</button>
      </section>
    </main>
  );
}

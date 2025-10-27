"use client";

import { useRef, useState } from "react";

export default function ReportLite() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function generate() {
    const f = inputRef.current?.files?.[0];
    if (!f) {
      setMsg("Pick a file first (PDF, DOCX/DOCM, XLSX/XLS/CSV).");
      return;
    }
    setBusy(true);
    setMsg("Generating…");

    try {
      const fd = new FormData();
      fd.append("file", f);

      const res = await fetch("/api/generate-report", { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";

      if (!res.ok) {
        const err = ct.includes("application/json") ? await res.json() : { error: await res.text() };
        setMsg(`Error: ${err?.error || res.statusText}`);
        setBusy(false);
        return;
      }

      if (!ct.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        const text = await res.text();
        setMsg("Unexpected response:\n" + text.slice(0, 400));
        setBusy(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RFP_Report_${Date.now()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Report downloaded.");
    } catch (e: any) {
      setMsg("Failed: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📝 Generate RFP Report</h2>
      <p style={{ color: "#6b7280", marginTop: 6, marginBottom: 12 }}>
        Upload a source file (PDF, DOCX/DOCM, XLSX/XLS/CSV). We’ll analyze it, match against your KB, and download a .docx.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.docm,.xlsx,.xls,.csv"
        style={{ display: "block", marginBottom: 10 }}
      />
      <button
        onClick={generate}
        disabled={busy}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: busy ? "#f3f4f6" : "#0ea5e9",
          color: busy ? "#6b7280" : "#fff",
          cursor: busy ? "not-allowed" : "pointer",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {busy ? "Generating…" : "Generate RFP Report"}
      </button>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: "#374151", whiteSpace: "pre-wrap" }}>{msg}</div>}
    </section>
  );
}

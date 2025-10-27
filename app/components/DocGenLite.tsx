"use client";

import React, { useState } from "react";

export default function DocGenLite({ selectedFile }: { selectedFile: File | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [filename, setFilename] = useState<string>("RFP_Report_Output.docx");

  async function onGenerate() {
    try {
      setMsg("");
      if (!selectedFile) {
        setMsg("Please choose a file at the top first. (That same file will be used for report generation.)");
        return;
      }
      setBusy(true);
      setMsg("Generating report…");

      const fd = new FormData();
      fd.append("file", selectedFile);

      const res = await fetch("/api/generate-report", {
        method: "POST",
        body: fd,
      });

      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        const text = ct.includes("application/json") ? JSON.stringify(await res.json()) : await res.text();
        throw new Error(`Server returned ${res.status}. ${text}`);
      }

      if (!ct.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        // If server returned JSON instead of a file, show it.
        const text = await res.text();
        setBusy(false);
        setMsg(text || "Unexpected response content type.");
        return;
      }

      const blob = await res.blob();
      const dlName = filename || "RFP_Report_Output.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = dlName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMsg("Report downloaded.");
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#374151" }}>
          <b>Selected file:</b> {selectedFile ? selectedFile.name : "— (use the top uploader)"}
        </div>
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="Output filename"
          style={{ padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}
          aria-label="Output filename"
        />
        <button
          onClick={onGenerate}
          disabled={busy || !selectedFile}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: busy || !selectedFile ? "#f3f4f6" : "#0ea5e9",
            color: busy || !selectedFile ? "#6b7280" : "#fff",
            cursor: busy || !selectedFile ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
          aria-busy={busy}
        >
          {busy ? "Working…" : "Generate RFP Report"}
        </button>
      </div>
      {msg && (
        <div
          style={{
            fontSize: 13,
            color: "#111827",
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

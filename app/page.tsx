"use client";
import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch("/api/generate-report", {
      method: "POST",
    });
    if (!res.ok) {
      alert("Report generation failed.");
      setLoading(false);
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "RFP_Report.docx";
    a.click();
    window.URL.revokeObjectURL(url);
    setLoading(false);
  }

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>RFP Autonomous Analyst MVP</h1>
      <p>✅ Deployment working.</p>
      <button
        onClick={handleGenerate}
        disabled={loading}
        style={{
          background: "#0070f3",
          color: "#fff",
          border: "none",
          padding: "10px 20px",
          borderRadius: "6px",
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Generating..." : "Generate Report"}
      </button>
    </main>
  );
}

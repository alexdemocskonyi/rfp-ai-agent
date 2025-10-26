"use client";
import React, { useState } from "react";

export default function Home() {
  const [log, setLog] = useState("idle");

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const form = new FormData();
    form.append("files", f);
    setLog("Uploading...");
    const res = await fetch("/api/ingest", { method: "POST", body: form });
    const data = await res.json();
    if (!data?.ok) {
      setLog(`Error: ${data?.error || "ingest failed"}`);
      return;
    }
    setLog(`Added ${data.count} • Embedded ${data.embedded}`);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>🧠 RFP AI (Local)</h1>
      <input type="file" onChange={upload} style={{ display: "block", margin: "12px 0" }} />
      <div style={{ marginTop: 12, color: "#555" }}>{log}</div>
    </main>
  );
}

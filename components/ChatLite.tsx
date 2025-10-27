"use client";

import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatLite() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! I’m your KB expert. Ask about policy, upload gaps, or draft answers." } satisfies Msg,
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");

    // Ensure `role` stays a string literal type (not widened to string)
    const next: Msg[] = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Chat failed");
      setMessages([...next, { role: "assistant" as const, content: data.message }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant" as const, content: "Error: " + (e?.message || e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 8, marginBottom: 10 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: m.role === "assistant" ? "#f8fafc" : "#e0f2fe",
              whiteSpace: "pre-wrap",
              lineHeight: 1.35,
              fontSize: 14,
            }}
          >
            <strong style={{ color: "#111827" }}>{m.role === "assistant" ? "Assistant" : "You"}:</strong>{" "}
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about KB content, maintenance, or draft wording…"
          rows={2}
          style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 14 }}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          style={{
            minWidth: 90,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: busy ? "#f3f4f6" : "#0ea5e9",
            color: busy ? "#6b7280" : "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

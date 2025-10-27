"use client";

import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

type Trio =
  | {
      contextual?: { text?: string; sourceHint?: string };
      raw?: { text?: string; sourceHint?: string };
      ai?: { text?: string; sourceHint?: string };
    }
  | undefined;

export default function ChatLite() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant" as const,
      content:
        "Hi! I’m your KB expert. Ask about policy, upload gaps, or draft answers.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  function formatTrio(trio: Trio): string | null {
    if (!trio) return null;

    const parts: string[] = [];

    const push = (label: string, text?: string, hint?: string) => {
      if (!text) return;
      parts.push(
        `[${label}]\n${text.trim()}${hint ? `\n\n(Source: ${hint})` : ""}`
      );
    };

    push("Contextual", trio.contextual?.text, trio.contextual?.sourceHint);
    push("Raw", trio.raw?.text, trio.raw?.sourceHint);
    push("AI", trio.ai?.text, trio.ai?.sourceHint);

    return parts.length ? parts.join("\n\n— — —\n\n") : null;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");

    const next: Msg[] = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const js = await res.json();

      // Support both the new multi-answer shape and the old single "message" shape.
      const trio: Trio =
        js?.answers ??
        (js?.ai || js?.raw || js?.contextual
          ? {
              ai: js.ai,
              raw: js.raw,
              contextual: js.contextual,
            }
          : undefined);

      const trioText = formatTrio(trio);

      const content =
        trioText ??
        String(
          js?.message ||
            "No answer. (The API did not return contextual/raw/AI fields.)"
        );

      setMessages((m) => [
        ...m,
        { role: "assistant" as const, content },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant" as const, content: "Error: " + (e?.message || e) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = send, Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
      <div
        style={{
          height: 240,
          overflow: "auto",
          padding: 10,
          background: "#f9fafb",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          marginBottom: 10,
          whiteSpace: "pre-wrap",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          fontSize: 14,
          color: "#111827",
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <strong>{m.role === "user" ? "You" : "Assistant"}:</strong>{" "}
            {m.content}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="Ask about KB content, maintenance, or draft wording… (Enter to send, Shift+Enter for newline)"
          style={{
            flex: 1,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "10px 12px",
            resize: "vertical",
          }}
        />
        <button
          onClick={send}
          disabled={busy}
          style={{
            minWidth: 80,
            border: "1px solid #0ea5e9",
            background: busy ? "#93c5fd" : "#0ea5e9",
            color: "#fff",
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type IngestResponse = {
  ok: boolean;
  batchId?: string;
  count?: number;
  embedded?: number;
  embeddingsKey?: string | null;
  error?: string;
};

type Toast = { id: string; type: "success" | "error" | "info"; msg: string };

function Toasts({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, display: "flex",
      flexDirection: "column", gap: 8, zIndex: 1000
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          style={{
            minWidth: 280,
            maxWidth: 420,
            padding: "10px 12px",
            borderRadius: 10,
            boxShadow: "0 6px 24px rgba(0,0,0,.12)",
            background: t.type === "success" ? "#0ea5e9" : t.type === "error" ? "#ef4444" : "#4b5563",
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1.35,
          }}
          role="status"
          aria-live="polite"
          title="Click to dismiss"
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  const [fileName, setFileName] = useState<string>("");
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const processingTimer = useRef<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  function addToast(type: Toast["type"], msg: string, ttl = 5000) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, msg }]);
    window.setTimeout(() => removeToast(id), ttl);
  }
  function removeToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  function resetUI() {
    setStage("idle");
    setPercent(0);
    setFileName("");
    if (processingTimer.current) {
      window.clearInterval(processingTimer.current);
      processingTimer.current = null;
    }
  }

  // abort in-flight XHR if the user picks a new file
  function abortInFlight() {
    try { xhrRef.current?.abort(); } catch {}
    xhrRef.current = null;
  }

  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    // reset UI for every new selection
    abortInFlight();
    resetUI();
    if (!f) return;

    setFileName(f.name);

    const fd = new FormData();
    fd.append("files", f);

    // Use XHR to track upload progress
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open("POST", "/api/ingest", true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.max(1, Math.min(100, Math.round((e.loaded / e.total) * 70))); // map to 1–70%
        setStage("uploading");
        setPercent(p);
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;

      // stop any fake “processing” animation
      if (processingTimer.current) {
        window.clearInterval(processingTimer.current);
        processingTimer.current = null;
      }

      try {
        const data: IngestResponse = JSON.parse(xhr.responseText || "{}");

        if (!data.ok) {
          setStage("error");
          setPercent(0);
          addToast("error", `Ingest failed: ${data.error || "unknown error"}`);
          return;
        }

        setStage("done");
        setPercent(100);
        addToast(
          "success",
          `Upload complete — Added ${data.count ?? 0} • Embedded ${data.embedded ?? 0}`
        );
      } catch (e: any) {
        setStage("error");
        addToast("error", `Bad response: ${e?.message || e}`);
      } finally {
        xhrRef.current = null;
      }
    };

    xhr.onerror = () => {
      if (processingTimer.current) {
        window.clearInterval(processingTimer.current);
        processingTimer.current = null;
      }
      setStage("error");
      addToast("error", "Network error during upload");
      xhrRef.current = null;
    };

    // kick off request
    xhr.send(fd);

    // When upload finishes but server is still working, show “Processing…”
    xhr.upload.onloadend = () => {
      if (stage !== "error") {
        setStage("processing");
        // smooth, indeterminate progress: 70 → 95 while we wait
        let p = 70;
        processingTimer.current = window.setInterval(() => {
          p = Math.min(95, p + 1);
          setPercent(p);
        }, 120) as unknown as number;
      }
    };
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortInFlight();
      if (processingTimer.current) window.clearInterval(processingTimer.current);
    };
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>🧠 RFP AI (Local)</h1>

      <label style={{ display: "inline-block", margin: "12px 0" }}>
        <input type="file" onChange={upload} style={{ display: "block", margin: "8px 0" }} />
      </label>

      {/* Status / progress */}
      {stage !== "idle" && (
        <div style={{ marginTop: 8, width: 420, maxWidth: "100%" }}>
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
            {stage === "uploading" && `Uploading ${fileName}…`}
            {stage === "processing" && `Processing ${fileName}…`}
            {stage === "done" && `Done`}
            {stage === "error" && `Error`}
          </div>
          <div
            style={{
              height: 10,
              width: "100%",
              background: "#e5e7eb",
              borderRadius: 999,
              overflow: "hidden",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,.06)",
            }}
            aria-label="progress"
          >
            <div
              style={{
                height: "100%",
                width: `${percent}%`,
                background:
                  stage === "error" ? "#ef4444" : stage === "done" ? "#10b981" : "#0ea5e9",
                transition: "width 120ms linear",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{percent}%</div>
        </div>
      )}

      <Toasts toasts={toasts} remove={removeToast} />
    </main>
  );
}

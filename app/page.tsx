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

type StatsResponse = {
  ok: boolean;
  itemsCount: number | null;
  embeddingsCount: number | null;
  qaPairsCount: number | null;
  qOnlyCount: number | null;
  error?: string;
};

type Toast = { id: string; type: "success" | "error" | "info"; msg: string };

function Toasts({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1000,
      }}
    >
      {toasts.map((t) => (
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

const nf = new Intl.NumberFormat();

export default function Page() {
  const [fileName, setFileName] = useState<string>("");
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<string>("");

  const processingTimer = useRef<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const erroredRef = useRef<boolean>(false);

  // Client-side max upload guard (MB)
  const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 10);

  function addToast(type: Toast["type"], msg: string, ttl = 5000) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, msg }]);
    window.setTimeout(() => removeToast(id), ttl);
  }
  function removeToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function resetUI() {
    setStage("idle");
    setPercent(0);
    setFileName("");
    erroredRef.current = false;
    if (processingTimer.current) {
      window.clearInterval(processingTimer.current);
      processingTimer.current = null;
    }
  }

  // Abort in-flight XHR if the user picks a new file
  function abortInFlight() {
    try {
      xhrRef.current?.abort();
    } catch {}
    xhrRef.current = null;
  }

  async function fetchStats() {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/test-supabase", { cache: "no-store" });
      const data: StatsResponse = await res.json();
      setStats(data);
      setStatsUpdatedAt(new Date().toLocaleTimeString());
      if (!data.ok && data.error) {
        addToast("error", `Stats error: ${data.error}`);
      }
    } catch (e: any) {
      addToast("error", `Stats fetch failed: ${e?.message || e}`);
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];

    // reset UI for every new selection
    abortInFlight();
    resetUI();
    if (!f) return;

    // size/type guard (client-side)
    const mb = f.size / (1024 * 1024);
    if (mb > MAX_MB) {
      addToast("error", `File too large (${mb.toFixed(1)} MB). Max ${MAX_MB} MB in this build.`);
      return;
    }
    const allowed = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
      "text/csv",
      "application/pdf",
    ]);
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const typeOk = allowed.has(f.type) || ["xlsx", "xls", "csv", "pdf"].includes(ext);
    if (!typeOk) {
      addToast("error", `Unsupported file type: ${f.type || "." + ext || "unknown"}`);
      return;
    }

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

      // stop “processing” animation if running
      if (processingTimer.current) {
        window.clearInterval(processingTimer.current);
        processingTimer.current = null;
      }

      const status = xhr.status;
      const ct = xhr.getResponseHeader("content-type") || "";
      const isJSON = ct.includes("application/json");

      if (!isJSON) {
        // Non-JSON (e.g., 413 Request Entity Too Large, HTML error page)
        let snippet = (xhr.responseText || "").slice(0, 160).replace(/\s+/g, " ").trim();
        if (status === 413) snippet = "File too large for server. Convert to CSV/XLSX or lower size limit.";
        if (status === 415) snippet = "Unsupported media type. Try CSV/XLSX/PDF.";
        if (status >= 500 && !snippet) snippet = "Server error while processing the file.";
        setStage("error");
        setPercent(0);
        erroredRef.current = true;
        addToast("error", `Upload failed (${status}). ${snippet || "Non-JSON response"}`);
        xhrRef.current = null;
        return;
      }

      try {
        const data: IngestResponse = JSON.parse(xhr.responseText || "{}");

        if (!data.ok) {
          setStage("error");
          setPercent(0);
          erroredRef.current = true;
          addToast("error", `Ingest failed: ${data.error || "unknown error"}`);
          return;
        }

        setStage("done");
        setPercent(100);
        addToast("success", `Upload complete — Added ${data.count ?? 0} • Embedded ${data.embedded ?? 0}`);

        // refresh stats on success
        fetchStats();
      } catch (e: any) {
        setStage("error");
        setPercent(0);
        erroredRef.current = true;
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
      setPercent(0);
      erroredRef.current = true;
      addToast("error", "Network error during upload");
      xhrRef.current = null;
    };

    // kick off request
    xhr.send(fd);

    // When upload finishes but server is still working, show “Processing…”
    xhr.upload.onloadend = () => {
      if (!erroredRef.current) {
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

  const items = stats?.itemsCount ?? 0;
  const embeddings = stats?.embeddingsCount ?? 0;
  const qaPairs = stats?.qaPairsCount ?? 0;
  const qOnly = stats?.qOnlyCount ?? 0;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>🧠 RFP AI</h1>

      {/* KB Stats Card */}
      <section
        style={{
          marginBottom: 16,
          padding: 16,
          borderRadius: 12,
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          boxShadow: "0 2px 10px rgba(0,0,0,.03)",
          maxWidth: 560,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18 }}>📊</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Knowledge Base</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {statsLoading
                  ? "Refreshing…"
                  : stats?.ok
                  ? `Updated ${statsUpdatedAt || "now"}`
                  : stats?.error
                  ? `Error: ${stats.error}`
                  : "—"}
              </div>
            </div>
          </div>
          <button
            onClick={fetchStats}
            disabled={statsLoading}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: statsLoading ? "#f3f4f6" : "#ffffff",
              color: "#111827",
              cursor: statsLoading ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
            aria-busy={statsLoading}
            aria-label="Refresh stats"
          >
            {statsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fff",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontSize: 12, color: "#6b7280" }}>Items</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{nf.format(items)}</div>
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fff",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontSize: 12, color: "#6b7280" }}>Embeddings</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{nf.format(embeddings)}</div>
          </div>

          {/* Content Mix: Q&A pairs vs Q-only */}
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fff",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Content Mix</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Q&A pairs</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{nf.format(qaPairs)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Q-only</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{nf.format(qOnly)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Uploader */}
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
                background: stage === "error" ? "#ef4444" : stage === "done" ? "#10b981" : "#0ea5e9",
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

"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Mount the beta UI blocks (no impact on existing flows)
const ChatLite = dynamic(() => import("./components/ChatLite"), { ssr: false });
const DocGenLite = dynamic(() => import("./components/DocGenLite"), { ssr: false });

type IngestResponse = {
  ok: boolean;
  batchId?: string;
  count?: number;
  embedded?: number;
  chunked?: number;
  embeddingsKey?: string | null;
  error?: string;
};

type StatsResponse = {
  ok: boolean;
  itemsCount: number | null;
  embeddingsCount: number | null;
  chunksCount: number | null;
  qaPairsCount: number | null;
  qOnlyCount: number | null;
  error?: string;
};

type Toast = { id: string; type: "success" | "error" | "info"; msg: string };

function Toasts({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<string>("");

  const processingTimer = useRef<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const erroredRef = useRef<boolean>(false);

  const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 1024); // effectively no limit here

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
      if (!data.ok && data.error) addToast("error", "Stats error: " + data.error);
    } catch (e: any) {
      addToast("error", "Stats fetch failed: " + (e?.message || e));
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    fetchStats();
  }, []);

  // ---------- Upload helpers ----------

  async function ingestViaUrl(url: string, name?: string) {
    try {
      const res = await fetch("/api/ingest-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, name }),
      });
      const data = (await res.json()) as IngestResponse;
      if (!data?.ok) throw new Error(data?.error || "ingest-url failed");
      setStage("done");
      setPercent(100);
      addToast(
        "success",
        `Upload complete — Added ${data.count ?? 0} • Embedded ${data.embedded ?? 0}${
          typeof data.chunked === "number" ? " • Chunks " + data.chunked : ""
        }`
      );
      fetchStats();
    } catch (e: any) {
      setStage("error");
      setPercent(0);
      addToast("error", "URL ingest failed: " + (e?.message || e));
    }
  }

  async function supabaseUpload(file: File) {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, anon);

    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
    const { error } = await supabase.storage
      .from("ingest")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
    if (error) throw error;

    const pub = supabase.storage.from("ingest").getPublicUrl(path);
    const publicUrl = pub.data?.publicUrl;
    if (!publicUrl) throw new Error("Could not create public URL");

    return { path, publicUrl };
  }

  async function uploadViaSupabase(file: File, previousErrorMsg?: string) {
    try {
      setStage("processing");
      const mb = file.size / (1024 * 1024);
      addToast("info", `Uploading direct to Supabase… (${mb.toFixed(1)} MB)`, 3500);

      const { publicUrl } = await supabaseUpload(file);
      await ingestViaUrl(publicUrl, file.name);
    } catch (e: any) {
      setStage("error");
      setPercent(0);
      addToast(
        "error",
        `Supabase upload failed: ${e?.message || e}${previousErrorMsg ? ` (fallback reason: ${previousErrorMsg})` : ""}`
      );

      const u = window.prompt("Upload failed. Paste a direct download URL to the same file:");
      if (u && /^https?:\/\//i.test(u.trim())) {
        addToast("info", "Trying server-side ingest by URL…", 2500);
        await ingestViaUrl(u.trim(), file.name);
      }
    }
  }

  // ---------- Main upload (single top button) ----------
  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];

    abortInFlight();
    resetUI();
    if (!f) return;

    setSelectedFile(f);

    const mb = f.size / (1024 * 1024);
    if (mb > MAX_MB) {
      addToast("error", "File too large (" + mb.toFixed(1) + " MB).");
      return;
    }

    const mime = (f.type || "").toLowerCase().trim();
    const ext = (f.name.split(".").pop() || "").toLowerCase().trim();
    const allowedExts = new Set(["xlsx", "xls", "csv", "pdf", "docx", "docm"]);
    const allowedMimes = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ]);
    const typeOk = allowedExts.has(ext) || allowedMimes.has(mime);
    if (!typeOk) {
      addToast("error", "Unsupported file type: " + (mime || "." + ext || "unknown"));
      return;
    }

    setFileName(f.name);

    // Always try server ingest first with progress.
    const fd = new FormData();
    fd.append("files", f);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/ingest", true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.max(1, Math.min(100, Math.round((e.loaded / e.total) * 70)));
        setStage("uploading");
        setPercent(p);
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;

      if (processingTimer.current) {
        window.clearInterval(processingTimer.current);
        processingTimer.current = null;
      }

      const status = xhr.status;
      const ct = xhr.getResponseHeader("content-type") || "";
      const isJSON = ct.includes("application/json");

      // If the platform says body too large, fall back to Supabase without any size gate.
      if (status === 413) {
        xhrRef.current = null;
        addToast("info", "Server rejected large body — switching to Supabase upload…", 3500);
        uploadViaSupabase(f, "HTTP 413 from /api/ingest");
        return;
      }

      if (!isJSON) {
        let snippet = (xhr.responseText || "").slice(0, 160).replace(/\s+/g, " ").trim();
        if (status === 415) snippet = "Unsupported media type. Try CSV/XLSX/PDF/DOCX.";
        if (status >= 500 && !snippet) snippet = "Server error while processing the file.";
        setStage("error");
        setPercent(0);
        erroredRef.current = true;
        addToast("error", "Upload failed (" + status + "). " + (snippet || "Non-JSON response"));
        xhrRef.current = null;
        return;
      }

      try {
        const data: IngestResponse = JSON.parse(xhr.responseText || "{}");
        if (!data.ok) {
          setStage("error");
          setPercent(0);
          erroredRef.current = true;
          addToast("error", "Ingest failed: " + (data.error || "unknown error"));
          return;
        }
        setStage("done");
        setPercent(100);
        addToast(
          "success",
          "Upload complete — Added " +
            (data.count ?? 0) +
            " • Embedded " +
            (data.embedded ?? 0) +
            (typeof data.chunked === "number" ? " • Chunks " + data.chunked : "")
        );
        fetchStats();
      } catch (e: any) {
        setStage("error");
        setPercent(0);
        erroredRef.current = true;
        addToast("error", "Bad response: " + (e?.message || e));
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

    xhr.send(fd);

    xhr.upload.onloadend = () => {
      if (!erroredRef.current) {
        setStage("processing");
        let p = 70;
        processingTimer.current = window.setInterval(() => {
          p = Math.min(95, p + 1);
          setPercent(p);
        }, 120) as unknown as number;
      }
    };
  }

  const items = stats?.itemsCount ?? 0;
  const embeddings = stats?.embeddingsCount ?? 0;
  const chunks = stats?.chunksCount ?? 0;
  const qaPairs = stats?.qaPairsCount ?? 0;
  const qOnly = stats?.qOnlyCount ?? 0;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>🧠 RFP AI</h1>

      {/* Upload + Stats */}
      <section
        style={{
          marginBottom: 16,
          padding: 16,
          borderRadius: 12,
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          boxShadow: "0 2px 10px rgba(0,0,0,.03)",
          maxWidth: 720,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18 }}>📊</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>Knowledge Base</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {statsLoading ? "Refreshing…" : stats?.ok ? "Updated " + (statsUpdatedAt || "now") : stats?.error ? "Error: " + stats.error : "—"}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
          <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Items</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{nf.format(items)}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Embeddings</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{nf.format(embeddings)}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e5e7eb" }}>
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
          <div style={{ padding: 12, borderRadius: 10, background: "#fff", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Context Chunks</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{nf.format(chunks)}</div>
          </div>
        </div>

        <label style={{ display: "inline-block", marginTop: 12 }}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,.docx,.docm"
            onChange={upload}
            style={{ display: "block", margin: "8px 0" }}
          />
        </label>

        {stage !== "idle" && (
          <div style={{ marginTop: 8, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
              {stage === "uploading" && "Uploading " + fileName + "…"}
              {stage === "processing" && "Processing " + fileName + "…"}
              {stage === "done" && "Done"}
              {stage === "error" && "Error"}
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
                  width: percent + "%",
                  background: stage === "error" ? "#ef4444" : stage === "done" ? "#10b981" : "#0ea5e9",
                  transition: "width 120ms linear",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{percent}%</div>
          </div>
        )}
      </section>

      <Toasts toasts={toasts} remove={removeToast} />

      <hr style={{ margin: "24px 0", border: "0", height: 1, background: "#e5e7eb" }} />

      {/* Assistant + Generator */}
      <section style={{ marginTop: 8, maxWidth: 900 }}>
        <details
          open
          style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff", marginBottom: 12 }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 16 }}>💬 Assistant (beta)</summary>
          <div style={{ marginTop: 12 }}>
            <ChatLite />
          </div>
        </details>

        <details open style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 16 }}>📝 Document Generator (beta)</summary>
          <div style={{ marginTop: 12 }}>
            <DocGenLite selectedFile={selectedFile} />
          </div>
        </details>
      </section>
    </main>
  );
}

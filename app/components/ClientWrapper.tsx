"use client";
import { useState, useEffect } from "react";

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const start = () => setLoading(true);
    const stop = () => setLoading(false);
    window.addEventListener("app-loading-start", start);
    window.addEventListener("app-loading-stop", stop);
    return () => {
      window.removeEventListener("app-loading-start", start);
      window.removeEventListener("app-loading-stop", stop);
    };
  }, []);

  return (
    <>
      {children}
      {loading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "50px",
              height: "50px",
              border: "6px solid #fff",
              borderTopColor: "#0070f3",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <style jsx global>{`
            @keyframes spin {
              from {
                transform: rotate(0deg);
              }
              to {
                transform: rotate(360deg);
              }
            }
          `}</style>
        </div>
      )}
    </>
  );
}

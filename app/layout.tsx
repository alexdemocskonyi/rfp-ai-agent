"use client";
import { useState, useEffect } from "react";

export const metadata = {
  title: "RFP Autonomous Analyst MVP",
  description: "Lightweight RFP AI report generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Listen for custom global events to toggle loading state
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: "Arial, sans-serif",
          background: "#f9f9f9",
          position: "relative",
          minHeight: "100vh",
        }}
      >
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
      </body>
    </html>
  );
}

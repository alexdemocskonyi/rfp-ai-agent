export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>RFP Autonomous Analyst MVP</h1>
      <p>✅ Deployment working.</p>
      <p>
        Test API route:{" "}
        <a href="/api/generate-report" target="_blank" style={{ color: "blue" }}>
          /api/generate-report
        </a>
      </p>
    </main>
  );
}

import ClientWrapper from "./components/ClientWrapper";
export const metadata = {
  title: "RFP Autonomous Analyst MVP",
  description: "Lightweight RFP AI report generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "Arial, sans-serif", background: "#f9f9f9" }}>
        <ClientWrapper>{children}</ClientWrapper>
      </body>
    </html>
  );
}

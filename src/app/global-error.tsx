"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 40 }}>
        <h2>Application error</h2>
        <p style={{ color: "#666" }}>{error.message}</p>
        <button onClick={reset}>Reload</button>
      </body>
    </html>
  );
}

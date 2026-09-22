"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * App-level error boundary — catches render errors below the root layout so
 * the shell (nav/header) survives. Reports the error to Sentry; capture is
 * best-effort and can never break the fallback UI.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        minHeight: "60vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1>Something went wrong</h1>
      <p>
        The page failed to load. Please try again — if it keeps happening, let
        the water delivery team know.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}

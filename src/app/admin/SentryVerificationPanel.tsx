"use client";

/**
 * TEMPORARY — issue #119 Stage A only.
 *
 * Admin-only manual trigger for a single Sentry server verification event in
 * Production. Renders only in the Production deployment; the server action
 * re-enforces admin + production + enabled independently. Remove with the
 * Stage B cleanup PR.
 */

import { useState } from "react";

import { Card } from "@/components/ui/Card";

import { sendSentryServerVerification } from "./sentryVerification";

export function SentryVerificationPanel() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // UI-level convenience only — the server action is the authorization and
  // environment boundary. `NEXT_PUBLIC_SENTRY_ENVIRONMENT` is inlined from
  // VERCEL_ENV at build time (see next.config.ts).
  if (process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== "production") {
    return null;
  }

  async function onSend() {
    const confirmed = window.confirm(
      "Send one technical Sentry test event from the Production server? " +
        "It changes no application data. Continue?",
    );
    if (!confirmed) return;
    setPending(true);
    setResult(null);
    try {
      const outcome = await sendSentryServerVerification();
      setResult(outcome.message);
    } catch {
      setResult("Request failed — check the structured logs.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <h2 className="text-sm font-semibold text-amber-900">
        Temporary Sentry verification
      </h2>
      <p className="mt-1 text-sm text-amber-800">
        Sends exactly one fixed technical test event to Sentry from this
        Production deployment to confirm error monitoring is working. It does
        not read or change any application data. This control is temporary and
        will be removed after verification.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onSend}
          disabled={pending}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send Sentry server test event"}
        </button>
        {result && <p className="text-xs text-amber-900">{result}</p>}
      </div>
    </Card>
  );
}

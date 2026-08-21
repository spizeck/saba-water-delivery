"use client";

import { useActionState } from "react";

import { sendContinuityReportNow, type SendContinuityReportState } from "./actions";

const initialState: SendContinuityReportState = { status: "idle" };

/**
 * Staff-only "Send Continuity Report Now" — immediately emails the
 * current continuity snapshot via the same Resend-based send function
 * the nightly cron job uses. Distinct from the "Generate Continuity
 * Report" link, which only downloads the PDF and never sends email.
 * See PRODUCT.md / TECHNICAL.md "Operational Continuity Snapshot".
 */
export function SendContinuityReportButton() {
  const [state, formAction, pending] = useActionState(sendContinuityReportNow, initialState);

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {pending ? "Sending\u2026" : "Send Continuity Report Now"}
        </button>
      </form>
      {state.status === "success" && (
        <p role="status" className="text-xs font-medium text-green-700">
          {state.message}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {state.message}
        </p>
      )}
    </div>
  );
}

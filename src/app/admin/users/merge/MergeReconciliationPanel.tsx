"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type {
  MergeReconciliationEntry,
  MergeReconciliationOverview,
} from "@/lib/domain/mergeReconciliation";

import {
  retryMergeReconciliationAction,
  type RetryMergeReconciliationState,
} from "./actions";

interface Props {
  overview: MergeReconciliationOverview;
  entries: MergeReconciliationEntry[];
}

const initialState: RetryMergeReconciliationState = { status: "idle" };

const STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "In progress",
  reconciled: "Reconciled",
  failed: "Failed",
};

const CATEGORY_LABELS: Record<string, string> = {
  transient: "Temporary service failure",
  permission: "Permission problem",
  configuration: "Configuration problem",
  invalid_record: "Malformed merge record",
  max_attempts: "Automatic retries exhausted",
};

/**
 * Operator visibility for account-merge sign-in cleanup (issue #73): how
 * much reconciliation work is outstanding, which merges still need it, and a
 * server-authoritative manual retry. Everything shown is sanitized — opaque
 * ids, state names, and failure categories only; never provider payloads.
 */
export function MergeReconciliationPanel({ overview, entries }: Props) {
  const [state, formAction, pending] = useActionState(
    retryMergeReconciliationAction,
    initialState,
  );

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">
        Sign-in cleanup status
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        After a merge, the merged-away account is immediately blocked from
        signing in and its Firebase identity is then removed — automatically,
        with retries. Entries below are merges whose cleanup is still
        outstanding.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          {overview.pending} pending
        </span>
        <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
          {overview.processing} in progress
        </span>
        {overview.staleProcessing > 0 && (
          <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800">
            {overview.staleProcessing} stale (auto-recovered)
          </span>
        )}
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
            overview.failed > 0
              ? "bg-red-50 text-red-800"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {overview.failed} failed
        </span>
      </div>

      {state.status !== "idle" && (
        <p
          role="alert"
          className={`mt-3 text-sm font-medium ${
            state.status === "success" ? "text-green-700" : "text-red-700"
          }`}
        >
          {state.message}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          All account merges are fully reconciled.
        </p>
      ) : (
        <div className="mt-4 flex flex-col divide-y divide-slate-100">
          {entries.map((entry) => (
            <div key={entry.eventId} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  Merge {entry.eventId.slice(0, 8)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {STATE_LABELS[entry.state] ?? entry.state}
                    {entry.lastFailureCategory
                      ? ` — ${CATEGORY_LABELS[entry.lastFailureCategory] ?? entry.lastFailureCategory}`
                      : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Merged {formatWhen(entry.createdAt)}
                  {entry.attemptCount > 0 &&
                    ` · ${entry.attemptCount} attempt${entry.attemptCount === 1 ? "" : "s"}`}
                  {entry.duplicateDisabled && " · account disabled"}
                  {entry.nextAttemptAt &&
                    entry.state === "pending" &&
                    ` · next retry ${formatWhen(entry.nextAttemptAt)}`}
                </p>
              </div>
              {entry.state !== "processing" && (
                <form action={formAction}>
                  <input type="hidden" name="eventId" value={entry.eventId} />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={pending}
                    className="!h-9 !px-3 !text-xs"
                  >
                    {pending ? "Retrying..." : "Retry now"}
                  </Button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatWhen(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "at an unknown time";
  const diffMs = Date.now() - time;
  if (diffMs < 0) return "soon";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

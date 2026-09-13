"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import type { OutboxAdminEntry } from "@/lib/notifications/outboxAdmin";

import { retryNotification, type RetryNotificationState } from "./actions";

const initialState: RetryNotificationState = { status: "idle" };

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/**
 * Admin-only view of terminally-failed notifications with a safe manual retry
 * (issue #53). Shows opaque ids and sanitized state only — no recipient email,
 * message body, or secrets. Retry is a server action; the server re-checks
 * admin authorization and the outbox state machine.
 */
export function NotificationOutboxList({
  failed,
}: {
  failed: OutboxAdminEntry[];
}) {
  const [state, formAction, pending] = useActionState(
    retryNotification,
    initialState,
  );

  if (failed.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No failed notifications. ✓ Delivery-confirmation emails that hit a
        transient provider error are retried automatically and only appear here
        once they reach a terminal failure.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status !== "idle" && state.message ? (
        <p
          className={
            state.status === "success"
              ? "text-sm text-green-700"
              : "text-sm text-red-700"
          }
        >
          {state.message}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Request</th>
              <th className="py-2 pr-4 font-medium">Attempts</th>
              <th className="py-2 pr-4 font-medium">Failure</th>
              <th className="py-2 pr-4 font-medium">Last attempt</th>
              <th className="py-2 pr-4 font-medium">Retry</th>
            </tr>
          </thead>
          <tbody>
            {failed.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-800">{entry.type}</td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-700">
                  {entry.requestId}
                </td>
                <td className="py-2 pr-4 text-slate-800">
                  {entry.attemptCount}
                </td>
                <td className="py-2 pr-4 text-slate-800">
                  {entry.failureCategory ?? "—"}
                  {entry.failureReason ? (
                    <span className="block text-xs text-slate-500">
                      {entry.failureReason}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-slate-700">
                  {formatTime(entry.lastAttemptAt)}
                </td>
                <td className="py-2 pr-4">
                  <form action={formAction}>
                    <input
                      type="hidden"
                      name="notificationId"
                      value={entry.id}
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={pending}
                      className="!h-9 !px-3 !text-sm"
                    >
                      Retry
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

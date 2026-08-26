"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatSabaDateTime } from "@/lib/utils/datetime";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";

import {
  getHistoryMatchesForUser,
  linkHistoryToUser,
  type LinkHistoryActionState,
  type PossibleHistoryMatch,
} from "../../actions";

interface Props {
  targetUid: string;
}

const initialState: LinkHistoryActionState = { status: "idle" };

export function LinkHistoryPanel({ targetUid }: Props) {
  const [matches, setMatches] = useState<PossibleHistoryMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");

  const [state, formAction, pending] = useActionState(linkHistoryToUser, initialState);

  useEffect(() => {
    let cancelled = false;
    getHistoryMatchesForUser(targetUid)
      .then((data) => {
        if (!cancelled) setMatches(data);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUid, state.status]);

  if (matches === null) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Possible unregistered request history</h2>
        <p className="mt-2 text-sm text-slate-500">Loading...</p>
      </Card>
    );
  }

  if (matches.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Possible unregistered request history</h2>
        <p className="mt-2 text-sm text-slate-500">
          No unregistered requests match this account&apos;s email or phone number.
        </p>
      </Card>
    );
  }

  const hasSuccess = state.status === "success";

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Possible unregistered request history</h2>
      <p className="mt-1 text-sm text-slate-600">
        These previously unregistered requests have a matching phone or email. Select the ones that
        belong to this resident and link them. Historical snapshots are preserved.
      </p>

      {hasSuccess && (
        <p className="mt-3 text-sm font-medium text-green-700">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="mt-3 text-sm font-medium text-red-700">{state.message}</p>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="targetUid" value={targetUid} />
        <div className="flex max-h-80 flex-col divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {matches.map((m) => {
            const request = m.request;
            const checked = selected.has(request.id);
            return (
              <label
                key={request.id}
                className="flex items-start gap-3 p-3 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name="requestIds"
                  value={request.id}
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(request.id);
                    else next.delete(request.id);
                    setSelected(next);
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {request.customer?.displayName || "Unnamed"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPhoneForDisplay(request.customer?.phone) ?? "No phone"}
                    {request.customer?.email ? ` · ${request.customer.email}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {request.village} — requested {formatSabaDateTime(request.requestedAt)} (
                    {request.status})
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Matched on {m.matchedOn.join(", ")}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Reason for linking
          <textarea
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </label>

        <Button
          type="submit"
          size="md"
          disabled={pending || selected.size === 0 || !reason.trim()}
        >
          {pending ? "Linking..." : `Link ${selected.size} request(s)`}
        </Button>
      </form>
    </Card>
  );
}

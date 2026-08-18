"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { WaterRequest } from "@/lib/domain/types";

import { claimRequest, type ClaimActionState } from "./actions";

const initialState: ClaimActionState = { status: "idle" };

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  requests: WaterRequest[];
  driverId: string;
}

export function RequestQueue({ requests, driverId }: Props) {
  if (requests.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Available requests</h2>
        <p className="mt-2 text-sm text-slate-600">
          No water requests are available right now. Check back soon.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">
        Available requests ({requests.length})
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        {requests.map((req) => (
          <RequestCard key={req.id} request={req} driverId={driverId} />
        ))}
      </div>
    </Card>
  );
}

function RequestCard({
  request,
  driverId,
}: {
  request: WaterRequest;
  driverId: string;
}) {
  const [state, formAction, pending] = useActionState(claimRequest, initialState);
  const isPreferredHold =
    request.status === "preferred_driver_hold" &&
    request.preferredDriverId === driverId;

  // After successful claim, show success briefly (page will revalidate).
  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">Claimed!</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            1,000 gal &mdash; {request.village}
          </p>
          <p className="mt-1 text-sm text-slate-600">{request.deliveryDirections}</p>
          <p className="mt-1 text-xs text-slate-500">
            Requested {formatAge(request.requestedAt)}
            {isPreferredHold && (
              <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                Preferred for you
              </span>
            )}
          </p>
        </div>
      </div>

      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      <form action={formAction} className="mt-3">
        <input type="hidden" name="requestId" value={request.id} />
        <Button type="submit" size="md" disabled={pending} className="w-full">
          {pending ? "Claiming\u2026" : "Claim Delivery"}
        </Button>
      </form>
    </div>
  );
}

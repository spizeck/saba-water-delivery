"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DriverOffer, WaterRequest } from "@/lib/domain/types";
import { formatWaterQuantity } from "@/lib/domain/quantity";

import { acceptOffer, declineOffer, type OfferActionState } from "./actions";

const initialState: OfferActionState = { status: "idle" };

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (hours < 24) return remainingMins > 0 ? `${hours}h ${remainingMins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CustomerInfo {
  displayName: string;
  phone: string | null;
}

interface Props {
  offer: DriverOffer;
  request: WaterRequest;
  customer: CustomerInfo | null;
  driverId: string;
}

export function OfferCard({ offer, request, customer }: Props) {
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptOffer, initialState);
  const [declineState, declineAction, declinePending] = useActionState(declineOffer, initialState);

  const isPreferredHold = request.status === "preferred_driver_hold";
  const pending = acceptPending || declinePending;
  // Drivers only need to know a delivery is urgent/critical, never WHY
  // (e.g. vulnerable-circumstance details) — see PRODUCT.md "Privacy".
  const isCritical = request.dispatchPriority === "critical";
  const isUrgent = request.dispatchPriority === "urgent";

  if (acceptState.status === "success") {
    return (
      <Card className="border-green-200 bg-green-50">
        <p className="text-sm font-medium text-green-800">
          {acceptState.message ?? "Delivery accepted!"}
        </p>
      </Card>
    );
  }

  if (declineState.status === "success") {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Next Delivery</h2>
        <p className="mt-2 text-sm text-slate-600">{declineState.message}</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Next Delivery</h2>
        <div className="flex shrink-0 gap-1.5">
          {isCritical && (
            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
              Critical delivery
            </span>
          )}
          {isUrgent && (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              Urgent delivery
            </span>
          )}
          {isPreferredHold && (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              Preferred for you
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <p className="text-xl font-bold text-slate-900">
          {customer?.displayName ?? "Customer"}
        </p>
        {customer?.phone && (
          <a href={`tel:${customer.phone}`} className="text-sm font-medium text-blue-700 underline">
            {customer.phone}
          </a>
        )}
        <p className="text-sm text-slate-600">{request.village}</p>
        <p className="text-sm text-slate-600">
          {formatWaterQuantity(request.loads)} &middot; Requested {formatAge(request.requestedAt)}
        </p>
      </div>

      <div className="mt-3 rounded-lg bg-slate-50 p-3">
        <p className="text-sm text-slate-700">{request.deliveryDirections}</p>
      </div>

      {request.requestNotes && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Notes / Comments</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{request.requestNotes}</p>
        </div>
      )}

      {(acceptState.status === "error" || declineState.status === "error") && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {acceptState.message ?? declineState.message}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-4">
        <form action={acceptAction} className="sm:flex-1">
          <input type="hidden" name="offerId" value={offer.id} />
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:!w-full">
            {acceptPending ? "Accepting\u2026" : "Accept Delivery"}
          </Button>
        </form>
        <form action={declineAction} className="sm:flex-1">
          <input type="hidden" name="offerId" value={offer.id} />
          <Button
            type="submit"
            variant="outline"
            size="lg"
            disabled={pending}
            className="w-full sm:!w-full"
          >
            {declinePending ? "Declining\u2026" : "Decline"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

"use client";

import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createBatch, type CreateBatchActionState } from "@/app/dispatcher/actions";
import { MAX_BATCH_SIZE } from "@/lib/domain/dispatchBatchSelection";
import { formatWaterQuantity, LOAD_GALLONS } from "@/lib/domain/quantity";
import type { DispatchPriority, RequestedLoads } from "@/lib/domain/types";
import { formatSabaDateTime } from "@/lib/utils/datetime";

interface DriverOption {
  uid: string;
  displayName: string;
  availabilityStatus: "online" | "offline";
  inCooldown: boolean;
  hasActiveDelivery: boolean;
}

interface RequestOption {
  id: string;
  customerName: string;
  village: string;
  loads: RequestedLoads;
  priority: DispatchPriority;
  requestedAt: string;
  preferredDriverId: string | null;
  preferredDriverName: string | null;
}

const PRIORITY_LABEL: Record<DispatchPriority, string> = {
  critical: "Critical",
  urgent: "Urgent",
  normal: "Normal",
};

const PRIORITY_COLOR: Record<DispatchPriority, string> = {
  critical: "bg-red-100 text-red-900",
  urgent: "bg-amber-50 text-amber-800",
  normal: "bg-slate-100 text-slate-600",
};

const initialState: CreateBatchActionState = { status: "idle" };

export function NewBatchForm({
  drivers,
  requests,
}: {
  drivers: DriverOption[];
  requests: RequestOption[];
}) {
  const [step, setStep] = useState<"driver" | "requests" | "review">("driver");
  const [driverId, setDriverId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [acknowledgedOverrides, setAcknowledgedOverrides] = useState(false);
  const [state, formAction, pending] = useActionState(createBatch, initialState);

  const selectedDriver = drivers.find((d) => d.uid === driverId) ?? null;

  // Preserve the dispatcher's selection order as the run-sheet sequence
  // — the request list itself defaults to priority-then-age order (see
  // `sortForBatchSelection`), but the dispatcher may deliberately check
  // boxes in a different order without the app silently re-sorting
  // their choice out from under them.
  const selectedRequests = useMemo(
    () => selectedIds.map((id) => requests.find((r) => r.id === id)!).filter(Boolean),
    [selectedIds, requests],
  );

  const overrideRequests = useMemo(
    () =>
      driverId
        ? selectedRequests.filter((r) => r.preferredDriverId && r.preferredDriverId !== driverId)
        : [],
    [selectedRequests, driverId],
  );

  const canProceedToReview = selectedIds.length > 0 && selectedIds.length <= MAX_BATCH_SIZE;
  const canSubmit = overrideRequests.length === 0 || acknowledgedOverrides;

  function toggleRequest(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_BATCH_SIZE) return prev;
      return [...prev, id];
    });
  }

  return (
    <Card>
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <StepLabel active={step === "driver"} done={Boolean(selectedDriver)}>
          1. Driver
        </StepLabel>
        <span>&rarr;</span>
        <StepLabel active={step === "requests"} done={selectedIds.length > 0}>
          2. Requests
        </StepLabel>
        <span>&rarr;</span>
        <StepLabel active={step === "review"} done={false}>
          3. Review &amp; confirm
        </StepLabel>
      </div>

      {step === "driver" && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-700">Select a driver</p>
          <p className="text-xs text-slate-500">
            The driver does not need to be online — a delivery run is a
            deliberate staff decision. Offline/cooldown status is shown so
            you can decide with full information.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {drivers.map((d) => (
              <label
                key={d.uid}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
                  driverId === d.uid ? "border-blue-600 bg-blue-50" : "border-slate-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="driverPick"
                    checked={driverId === d.uid}
                    onChange={() => setDriverId(d.uid)}
                  />
                  <span className="font-medium text-slate-900">{d.displayName}</span>
                </div>
                <div className="flex gap-1.5">
                  <StatusBadge
                    label={d.availabilityStatus === "online" ? "Online" : "Offline"}
                    color={d.availabilityStatus === "online" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}
                  />
                  {d.inCooldown && <StatusBadge label="In cooldown" color="bg-amber-50 text-amber-800" />}
                  {d.hasActiveDelivery && (
                    <StatusBadge label="Has active delivery" color="bg-indigo-50 text-indigo-800" />
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Button
              type="button"
              size="md"
              disabled={!driverId}
              onClick={() => setStep("requests")}
              className="text-sm !h-9 !px-3"
            >
              Next: choose requests
            </Button>
          </div>
        </div>
      )}

      {step === "requests" && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-700">
            Select requests for {selectedDriver?.displayName}
          </p>
          <p className="text-xs text-slate-500">
            Listed in the normal dispatch order — highest priority first,
            oldest first within the same priority. Selected: {selectedIds.length}
            {" / "}
            {MAX_BATCH_SIZE}
          </p>
          <div className="mt-2 flex max-h-96 flex-col gap-2 overflow-y-auto">
            {requests.map((r) => {
              const isOverride = Boolean(
                r.preferredDriverId && driverId && r.preferredDriverId !== driverId,
              );
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
                    selectedIds.includes(r.id) ? "border-blue-600 bg-blue-50" : "border-slate-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleRequest(r.id)}
                    />
                    <div>
                      <p className="font-medium text-slate-900">
                        {r.customerName} &mdash; {r.village}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatWaterQuantity(r.loads)} &middot; Requested {formatSabaDateTime(r.requestedAt)}
                      </p>
                      {r.preferredDriverName && (
                        <p className={`text-xs ${isOverride ? "font-semibold text-amber-800" : "text-slate-500"}`}>
                          {isOverride
                            ? `Held for preferred driver: ${r.preferredDriverName} (selecting this overrides that preference)`
                            : `Preferred driver: ${r.preferredDriverName}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLOR[r.priority]}`}>
                    {PRIORITY_LABEL[r.priority]}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="md"
              disabled={!canProceedToReview}
              onClick={() => setStep("review")}
              className="text-sm !h-9 !px-3"
            >
              Next: review
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setStep("driver")}
              className="text-sm !h-9 !px-3"
            >
              Back
            </Button>
          </div>
        </div>
      )}

      {step === "review" && selectedDriver && (
        <form action={formAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="driverId" value={selectedDriver.uid} />
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="requestIds" value={id} />
          ))}
          {acknowledgedOverrides &&
            overrideRequests.map((r) => (
              <input key={r.id} type="hidden" name="acknowledgedOverrideRequestIds" value={r.id} />
            ))}

          <p className="text-sm font-medium text-slate-700">
            Review delivery run for {selectedDriver.displayName}
          </p>

          {/* Summary */}
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-700">
                <span className="font-bold">Driver:</span> {selectedDriver.displayName}
              </span>
              <span className="text-slate-700">
                <span className="font-semibold">{selectedIds.length}</span>{" "}
                request{selectedIds.length !== 1 ? "s" : ""}
              </span>
              <span className="text-slate-700">
                <span className="font-semibold">{selectedRequests.reduce((sum, r) => sum + r.loads, 0)}</span>{" "}
                load{selectedRequests.reduce((sum, r) => sum + r.loads, 0) !== 1 ? "s" : ""}
              </span>
              <span className="text-slate-500">
                {selectedRequests.reduce((sum, r) => sum + r.loads * LOAD_GALLONS, 0).toLocaleString("en-US")} gallons
              </span>
            </div>
          </div>

          <ol className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-3 text-sm">
            {selectedRequests.map((r, i) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {i + 1}. {r.customerName} &mdash; {r.village}
                  <span className="ml-1.5 text-xs text-slate-500">{formatWaterQuantity(r.loads)}</span>
                </span>
                <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLOR[r.priority]}`}>
                  {PRIORITY_LABEL[r.priority]}
                </span>
              </li>
            ))}
          </ol>

          {overrideRequests.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                {overrideRequests.length} of these requests are held for a different
                resident-preferred driver
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-900">
                {overrideRequests.map((r) => (
                  <li key={r.id}>
                    {r.customerName} — held for {r.preferredDriverName}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledgedOverrides}
                  onChange={(e) => setAcknowledgedOverrides(e.target.checked)}
                />
                I understand this overrides {overrideRequests.length} preferred-driver
                assignment{overrideRequests.length === 1 ? "" : "s"} and want to proceed.
              </label>
            </div>
          )}

          {state.status === "error" && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {state.message}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="md" disabled={pending || !canSubmit} className="text-sm !h-9 !px-3">
              {pending ? "Assigning\u2026" : "Create Delivery Run"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setStep("requests")}
              disabled={pending}
              className="text-sm !h-9 !px-3"
            >
              Back
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function StepLabel({
  active,
  done,
  children,
}: {
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={active ? "font-bold text-blue-700" : done ? "text-slate-700" : "text-slate-400"}>
      {children}
    </span>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

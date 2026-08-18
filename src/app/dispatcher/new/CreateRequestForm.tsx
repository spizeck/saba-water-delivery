"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EligibleDriverOption } from "@/lib/domain/drivers";
import type { ResidentDirectoryEntry } from "@/lib/domain/users";

import { createManualRequest, type CreateRequestActionState } from "../actions";

const initialState: CreateRequestActionState = { status: "idle" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Props {
  residents: ResidentDirectoryEntry[];
  eligibleDrivers: EligibleDriverOption[];
  residentsWithActiveRequest: string[];
}

export function CreateRequestForm({
  residents,
  eligibleDrivers,
  residentsWithActiveRequest,
}: Props) {
  const router = useRouter();
  const activeSet = useMemo(
    () => new Set(residentsWithActiveRequest),
    [residentsWithActiveRequest],
  );

  const [step, setStep] = useState<"form" | "review">("form");
  const [customerType, setCustomerType] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [selectedResident, setSelectedResident] = useState<ResidentDirectoryEntry | null>(null);

  const [village, setVillage] = useState("");
  const [deliveryDirections, setDeliveryDirections] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [preferredDriverId, setPreferredDriverId] = useState("none");
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);

  const [state, formAction, pending] = useActionState(createManualRequest, initialState);

  const filteredResidents = useMemo(() => {
    if (!search.trim()) return residents.slice(0, 20);
    const q = search.toLowerCase();
    return residents
      .filter(
        (r) =>
          r.displayName.toLowerCase().includes(q) ||
          (r.phone?.toLowerCase().includes(q) ?? false) ||
          (r.email?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 20);
  }, [residents, search]);

  const selectedDriver = eligibleDrivers.find((d) => d.uid === preferredDriverId);
  const selectedHasActiveRequest = selectedResident
    ? activeSet.has(selectedResident.uid)
    : false;

  function selectResident(resident: ResidentDirectoryEntry) {
    setSelectedResident(resident);
    setVillage(resident.village ?? "");
    setDeliveryDirections(resident.deliveryDirections ?? "");
  }

  function canReview(): boolean {
    if (!village.trim() || !deliveryDirections.trim()) return false;
    if (customerType === "existing") {
      return Boolean(selectedResident) && !selectedHasActiveRequest;
    }
    return customerName.trim().length > 0 && customerPhone.trim().length > 0;
  }

  if (state.status === "success") {
    return (
      <Card className="!border-green-200 !bg-green-50">
        <p className="text-sm font-medium text-green-800">{state.message}</p>
        <div className="mt-4 flex gap-2">
          <Button size="md" onClick={() => router.push("/dispatcher")}>
            Back to dashboard
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              setStep("form");
              setSelectedResident(null);
              setSearch("");
              setVillage("");
              setDeliveryDirections("");
              setCustomerName("");
              setCustomerPhone("");
              setCustomerEmail("");
              setPreferredDriverId("none");
              setOverrideDuplicate(false);
              router.refresh();
            }}
          >
            Create another
          </Button>
        </div>
      </Card>
    );
  }

  if (step === "form") {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Customer</h2>
        <div className="mt-3 flex gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="radio"
              name="customerTypeChoice"
              checked={customerType === "existing"}
              onChange={() => setCustomerType("existing")}
            />
            Existing resident
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="radio"
              name="customerTypeChoice"
              checked={customerType === "new"}
              onChange={() => setCustomerType("new")}
            />
            New / unregistered
          </label>
        </div>

        {customerType === "existing" ? (
          <div className="mt-4 flex flex-col gap-3">
            <input
              type="text"
              placeholder="Search by name, phone, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
            <div className="flex max-h-56 flex-col divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {filteredResidents.length === 0 && (
                <p className="p-3 text-sm text-slate-500">No matching residents.</p>
              )}
              {filteredResidents.map((r) => {
                const hasActive = activeSet.has(r.uid);
                const isSelected = selectedResident?.uid === r.uid;
                return (
                  <button
                    type="button"
                    key={r.uid}
                    onClick={() => selectResident(r)}
                    className={`flex items-center justify-between gap-2 p-3 text-left text-sm hover:bg-slate-50 ${
                      isSelected ? "bg-blue-50" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">
                        {r.displayName || "Unnamed"}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {r.phone ?? "No phone"}
                        {r.village ? ` · ${r.village}` : ""}
                      </span>
                    </span>
                    {hasActive && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Active request
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedResident && selectedHasActiveRequest && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {selectedResident.displayName} already has an unresolved water
                request. Resolve it from the dashboard before creating a new one.
              </p>
            )}

            {selectedResident && !selectedHasActiveRequest && (
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Village/area
                  <input
                    value={village}
                    onChange={(e) => setVillage(e.target.value)}
                    className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                  Delivery directions for this request
                  <textarea
                    value={deliveryDirections}
                    onChange={(e) => setDeliveryDirections(e.target.value)}
                    rows={3}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <span className="text-xs font-normal text-slate-500">
                    Only applies to this request — the resident&apos;s saved
                    profile is not changed.
                  </span>
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Customer name
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Phone number
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Email (optional)
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Village/area
              <input
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Delivery directions
              <textarea
                value={deliveryDirections}
                onChange={(e) => setDeliveryDirections(e.target.value)}
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </label>
            <p className="text-xs text-slate-500">
              This customer will not have an application account. No email
              address or login is required to receive water.
            </p>
          </div>
        )}

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
          Preferred driver
          <select
            value={preferredDriverId}
            onChange={(e) => setPreferredDriverId(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="none">No preference</option>
            {eligibleDrivers.map((d) => (
              <option key={d.uid} value={d.uid}>
                {d.displayName}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-slate-500">
            This is the customer&apos;s preference, not a dispatcher assignment.
          </span>
        </label>

        <div className="mt-4">
          <Button
            size="lg"
            disabled={!canReview()}
            onClick={() => setStep("review")}
            className="w-full"
          >
            Review Request
          </Button>
        </div>
      </Card>
    );
  }

  // --- Review step ---
  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Confirm request</h2>

      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-slate-500">Customer</dt>
          <dd className="text-slate-900">
            {customerType === "existing" ? selectedResident?.displayName : customerName}
          </dd>
          <dd className="text-slate-600">
            {customerType === "existing" ? selectedResident?.phone ?? "No phone" : customerPhone}
          </dd>
          {customerType === "new" && (
            <dd className="text-xs text-slate-500">Unregistered customer — no account.</dd>
          )}
        </div>
        <div>
          <dt className="font-medium text-slate-500">Delivery location</dt>
          <dd className="text-slate-900">{village}</dd>
          <dd className="text-slate-600">{deliveryDirections}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Quantity</dt>
          <dd className="text-slate-900">1,000 gallons</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Preferred driver</dt>
          <dd className="text-slate-900">
            {selectedDriver ? selectedDriver.displayName : "No preference"}
          </dd>
        </div>
      </dl>

      {state.status === "duplicate_warning" && !overrideDuplicate && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">{state.message}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {state.duplicates?.map((d) => (
              <li key={d.id} className="text-xs text-amber-800">
                {d.village} — requested {formatDate(d.requestedAt)} ({d.status})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">
            Phone matching is not identity verification. Only proceed if you
            have confirmed this is a different request.
          </p>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="mt-3"
            onClick={() => setOverrideDuplicate(true)}
          >
            This is not a duplicate — continue
          </Button>
        </div>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}

      <form
        action={formAction}
        className="mt-4 flex flex-col gap-3 sm:flex-row"
      >
        <input type="hidden" name="customerType" value={customerType} />
        <input type="hidden" name="village" value={village} />
        <input type="hidden" name="deliveryDirections" value={deliveryDirections} />
        <input type="hidden" name="preferredDriverId" value={preferredDriverId} />
        {customerType === "existing" ? (
          <input type="hidden" name="residentUid" value={selectedResident?.uid ?? ""} />
        ) : (
          <>
            <input type="hidden" name="customerName" value={customerName} />
            <input type="hidden" name="customerPhone" value={customerPhone} />
            <input type="hidden" name="customerEmail" value={customerEmail} />
          </>
        )}
        <input
          type="hidden"
          name="overrideDuplicate"
          value={overrideDuplicate ? "true" : "false"}
        />

        {(state.status !== "duplicate_warning" || overrideDuplicate) && (
          <Button type="submit" size="lg" disabled={pending}>
            {pending
              ? "Creating\u2026"
              : overrideDuplicate
                ? "Create anyway"
                : "Create Request"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={() => setStep("form")}
        >
          Go back
        </Button>
      </form>
    </Card>
  );
}

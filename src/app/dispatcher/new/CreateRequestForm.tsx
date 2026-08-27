"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  EMPTY_WATER_SITUATION,
  isWaterSituationComplete,
  WaterSituationFields,
  WaterSituationHiddenFields,
} from "@/components/forms/WaterSituationFields";
import type { EligibleDriverOption } from "@/lib/domain/driverRegistry";
import { findIdentityMatches, findStrongEmailMatch } from "@/lib/domain/identityMatching";
import { formatWaterQuantity, type RequestedLoads } from "@/lib/domain/quantity";
import { SABA_VILLAGES, isValidSabaVillage } from "@/lib/domain/villages";
import type { ResidentDirectoryEntry } from "@/lib/domain/users";
import { formatPhoneForDisplay } from "@/lib/utils/formatPhone";
import { formatSabaDateTime } from "@/lib/utils/datetime";

import {
  checkEmailAccountStatus,
  createManualRequest,
  getFrequentRequestCount,
  type CreateRequestActionState,
  type EmailAccountStatus,
} from "../actions";

const initialState: CreateRequestActionState = { status: "idle" };

const formatDate = formatSabaDateTime;

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

  const [loads, setLoads] = useState<RequestedLoads>(1);
  const [village, setVillage] = useState("");
  const [deliveryDirections, setDeliveryDirections] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [preferredDriverId, setPreferredDriverId] = useState("none");
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);
  const [waterSituation, setWaterSituation] = useState(EMPTY_WATER_SITUATION);
  const [attestationChecked, setAttestationChecked] = useState(false);
  const [frequentCount, setFrequentCount] = useState<number | null>(null);
  const [, startFrequentTransition] = useTransition();

  const [emailStatus, setEmailStatus] = useState<EmailAccountStatus | null>(null);
  const [emailStatusLoading, setEmailStatusLoading] = useState(false);
  const [useExistingResidentUid, setUseExistingResidentUid] = useState<string | null>(null);
  const [sendInvitation, setSendInvitation] = useState(true);

  const possibleMatches = useMemo(() => {
    if (customerType !== "new") return [];
    const matches = findIdentityMatches(
      {
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
      },
      residents,
    ).filter((m) => m.strength !== "weak");

    const strongEmailMatch = findStrongEmailMatch(
      { name: customerName, phone: customerPhone, email: customerEmail },
      residents,
    );

    return strongEmailMatch
      ? matches.filter((m) => m.resident.uid !== strongEmailMatch.resident.uid)
      : matches;
  }, [customerType, customerName, customerPhone, customerEmail, residents]);

  const selectedPossibleMatch = useMemo(
    () => residents.find((r) => r.uid === useExistingResidentUid) ?? null,
    [residents, useExistingResidentUid],
  );

  const [state, formAction, pending] = useActionState(createManualRequest, initialState);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        let count = 0;
        if (customerType === "existing" && selectedResident) {
          const result = await getFrequentRequestCount({
            customerId: selectedResident.uid,
            phone: selectedResident.phone ?? null,
          });
          count = result.count;
        } else if (useExistingResidentUid) {
          const match = residents.find((r) => r.uid === useExistingResidentUid);
          if (match) {
            const result = await getFrequentRequestCount({
              customerId: match.uid,
              phone: match.phone ?? null,
            });
            count = result.count;
          }
        } else if (customerType === "new" && customerPhone.trim()) {
          const result = await getFrequentRequestCount({
            customerId: null,
            phone: customerPhone.trim(),
          });
          count = result.count;
        } else {
          if (!cancelled) setFrequentCount(null);
          return;
        }
        if (!cancelled) setFrequentCount(count);
      } catch {
        if (!cancelled) setFrequentCount(null);
      }
    }

    if (customerType === "new" && customerPhone.trim()) {
      timeoutId = setTimeout(() => {
        startFrequentTransition(() => load());
      }, 300);
    } else {
      startFrequentTransition(() => load());
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [customerType, selectedResident, customerPhone, useExistingResidentUid, residents]);

  // Check email against Firebase Auth when it changes (debounced).
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      const email = customerEmail.trim();
      if (!email || customerType !== "new") {
        if (!cancelled) {
          setEmailStatus(null);
          setEmailStatusLoading(false);
        }
        return;
      }

      if (!cancelled) setEmailStatusLoading(true);
      try {
        const status = await checkEmailAccountStatus(email);
        if (!cancelled) {
          setEmailStatus(status);
          // If an existing account is found, pre-select it for the
          // dispatcher to confirm; they can still deselect and proceed
          // unregistered if appropriate.
          if (status.exists) {
            setUseExistingResidentUid(status.uid);
          } else {
            setUseExistingResidentUid(null);
          }
        }
      } catch {
        if (!cancelled) setEmailStatus(null);
      } finally {
        if (!cancelled) setEmailStatusLoading(false);
      }
    }

    timeoutId = setTimeout(() => {
      load();
    }, 300);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [customerType, customerEmail]);

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
  const selectedSavedAreaInvalid = selectedResident?.village
    ? !isValidSabaVillage(selectedResident.village)
    : false;

  function selectResident(resident: ResidentDirectoryEntry) {
    setSelectedResident(resident);
    // Only prefill the request location from the saved profile when the
    // saved value is a currently canonical village. Legacy/noncanonical
    // values are shown for awareness but must be explicitly replaced by
    // the dispatcher.
    setVillage(isValidSabaVillage(resident.village) ? resident.village : "");
    setDeliveryDirections(resident.deliveryDirections ?? "");
  }

  function changeResident() {
    setSelectedResident(null);
    setSearch("");
    // Reset requestor-derived location fields so stale information is not
    // accidentally submitted for the newly selected requestor.
    setVillage("");
    setDeliveryDirections("");
  }

  function canReview(): boolean {
    if (!village.trim() || !deliveryDirections.trim()) return false;
    if (!isWaterSituationComplete(waterSituation)) return false;
    if (customerType === "existing") {
      return Boolean(selectedResident) && !selectedHasActiveRequest;
    }
    // New / unregistered: name + phone are required. Using an existing
    // resident (from an email match) also satisfies the identity check.
    if (useExistingResidentUid) return true;
    return customerName.trim().length > 0 && customerPhone.trim().length > 0;
  }

  const URGENCY_LABEL: Record<string, string> = {
    normal: "Normal",
    critical: "Critical",
  };

  const VULNERABLE_LABEL: Record<string, string> = {
    elderly: "Elderly person",
    infant_or_young_child: "Infant or young child",
    medical_need: "Medical need",
    essential_services_commercial_business: "Essential services (Commercial/business)",
    hotel_or_restaurant: "Hotel or Restaurant",
  };

  const inputClasses =
    "h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none";

  function resetFormAndRefresh() {
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
    setWaterSituation(EMPTY_WATER_SITUATION);
    setAttestationChecked(false);
    setFrequentCount(null);
    setEmailStatus(null);
    setEmailStatusLoading(false);
    setUseExistingResidentUid(null);
    setSendInvitation(false);
    router.refresh();
  }

  if (state.status === "success" || state.status === "invitation_warning") {
    return (
      <Card
        className={
          state.status === "invitation_warning"
            ? "!border-amber-200 !bg-amber-50"
            : "!border-green-200 !bg-green-50"
        }
      >
        <p
          className={
            state.status === "invitation_warning"
              ? "text-sm font-medium text-amber-800"
              : "text-sm font-medium text-green-800"
          }
        >
          {state.message}
        </p>
        {state.status === "invitation_warning" && state.invitation?.emailError && (
          <p className="mt-1 text-xs text-amber-700">{state.invitation.emailError}</p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button size="md" onClick={() => router.push("/dispatcher")}>
            Back to dashboard
          </Button>
          <Button variant="outline" size="md" onClick={resetFormAndRefresh}>
            Create another
          </Button>
        </div>
      </Card>
    );
  }

  if (step === "form") {
    return (
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Requestor</h2>
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
            {!selectedResident ? (
              <>
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
                    return (
                      <button
                        type="button"
                        key={r.uid}
                        onClick={() => selectResident(r)}
                        className="flex items-center justify-between gap-2 p-3 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">
                            {r.displayName || "Unnamed"}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {formatPhoneForDisplay(r.phone) ?? "No phone"}
                            {r.village ? ` · Saved area: ${r.village}` : ""}
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
              </>
            ) : (
              <>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
                        Selected requestor
                      </p>
                      <p className="mt-1 truncate text-base font-semibold text-slate-900">
                        {selectedResident.displayName || "Unnamed"}
                      </p>
                      <p className="truncate text-sm text-slate-700">
                        {formatPhoneForDisplay(selectedResident.phone) ?? "No phone"}
                      </p>
                      {selectedResident.village ? (
                        <p
                          className={`truncate text-sm ${
                            selectedSavedAreaInvalid ? "font-medium text-red-700" : "text-slate-600"
                          }`}
                        >
                          Saved area: {selectedResident.village}
                          {selectedSavedAreaInvalid ? " — Needs update" : ""}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">No saved area</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={changeResident}
                      className="shrink-0"
                    >
                      Change
                    </Button>
                  </div>
                </div>

                {selectedHasActiveRequest && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {selectedResident.displayName} already has an unresolved water request. Resolve
                    it from the dashboard before creating a new one.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Requestor name
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={inputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Phone number
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className={inputClasses}
              />
            </label>

            {frequentCount !== null && frequentCount >= 3 && (
              <FrequentRequestWarning count={frequentCount} />
            )}

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Email (optional)
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => {
                  setCustomerEmail(e.target.value);
                  setUseExistingResidentUid(null);
                  setSendInvitation(false);
                }}
                className={inputClasses}
              />
            </label>

            {/* Optional account section */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Online account</h3>

              {emailStatusLoading && (
                <p className="mt-2 text-xs text-slate-500">Checking email...</p>
              )}

              {!emailStatusLoading && !customerEmail.trim() && (
                <p className="mt-2 text-xs text-slate-600">
                  No email provided. This requestor can continue without an online account.
                </p>
              )}

              {!emailStatusLoading && customerEmail.trim() && !emailStatus && (
                <p className="mt-2 text-xs text-slate-500">
                  This is optional. The request can be created without an online account.
                </p>
              )}

              {!emailStatusLoading && emailStatus?.exists && emailStatus.uid && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs font-medium text-blue-800">
                    Existing account found for this email
                  </p>
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-2">
                    <p className="text-sm font-medium text-slate-900">
                      {emailStatus.displayName || "Unnamed resident"}
                    </p>
                    <p className="text-xs text-slate-600">{emailStatus.email}</p>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={useExistingResidentUid === emailStatus.uid}
                      onChange={(e) =>
                        setUseExistingResidentUid(e.target.checked ? emailStatus.uid : null)
                      }
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>Use this resident account for the request</span>
                  </label>
                </div>
              )}

              {!emailStatusLoading && emailStatus && !emailStatus.exists && customerEmail.trim() && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-slate-600">
                    No existing account uses this email. You can invite the requestor to
                    set one up, or leave it blank and create the request without an account.
                  </p>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={sendInvitation}
                      onChange={(e) => setSendInvitation(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>Send account setup instructions</span>
                  </label>
                </div>
              )}

              {possibleMatches.length > 0 && !useExistingResidentUid && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-xs font-medium text-amber-800">
                    Possible existing resident{possibleMatches.length > 1 ? "s" : ""} found
                  </p>
                  <ul className="mt-2 space-y-2">
                    {possibleMatches.map((m) => (
                      <li key={m.resident.uid} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {m.resident.displayName || "Unnamed resident"}
                            </p>
                            <p className="text-xs text-slate-600">
                              {formatPhoneForDisplay(m.resident.phone) ?? "No phone"}
                              {m.resident.email ? ` · ${m.resident.email}` : ""}
                            </p>
                            <p className="text-xs text-amber-700">
                              Matched on{" "}
                              {m.matchedOn
                                .map((field) =>
                                  field === "email"
                                    ? "email"
                                    : field === "phone"
                                      ? "phone"
                                      : "name",
                                )
                                .join(", ")}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setUseExistingResidentUid(m.resident.uid)}
                            className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                          >
                            Use this account
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">
                    Phone matches are not proof of identity — only select a match if you are
                    confident it is the same person.
                  </p>
                </div>
              )}

              {useExistingResidentUid && emailStatus?.exists && emailStatus.uid !== useExistingResidentUid && (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2">
                  <p className="text-xs text-blue-800">
                    Using existing account from email match.
                  </p>
                </div>
              )}

              {useExistingResidentUid && (!emailStatus?.exists || emailStatus.uid !== useExistingResidentUid) && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                  <p className="text-xs text-amber-800">
                    An existing resident account will be used for this request.
                  </p>
                  <button
                    type="button"
                    onClick={() => setUseExistingResidentUid(null)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Undo
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Delivery location — shown for unregistered requestors and for selected
            existing residents who do not already have an active request. */}
        {(customerType === "new" || (selectedResident && !selectedHasActiveRequest)) && (
          <div className="mt-6 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-slate-900">Delivery location</h3>
            <p className="text-xs text-slate-500">
              Applies to this request only — does not change the requestor&apos;s saved profile.
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Village/area
              <select
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                required
                className={inputClasses}
              >
                <option value="">Select a village...</option>
                {SABA_VILLAGES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
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

            {customerType === "existing" && frequentCount !== null && frequentCount >= 3 && (
              <FrequentRequestWarning count={frequentCount} />
            )}
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-base font-semibold text-slate-900">Water requested</h3>
          <fieldset className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="radio"
                name="loadsChoice"
                value={1}
                checked={loads === 1}
                onChange={() => setLoads(1)}
                required
              />
              1 load (1,000 gallons)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="radio"
                name="loadsChoice"
                value={2}
                checked={loads === 2}
                onChange={() => setLoads(2)}
                required
              />
              2 loads (2,000 gallons)
            </label>
          </fieldset>
        </div>

        <div className="mt-6">
          <WaterSituationFields value={waterSituation} onChange={setWaterSituation} />
        </div>

        <label className="mt-6 flex flex-col gap-1 text-sm font-medium text-slate-700">
          Preferred driver
          <select
            value={preferredDriverId}
            onChange={(e) => setPreferredDriverId(e.target.value)}
            className={inputClasses}
          >
            <option value="none">No preference</option>
            {eligibleDrivers.map((d) => (
              <option key={d.uid} value={d.uid}>
                {d.displayName}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-slate-500">
            This is the requestor&apos;s preference, not a dispatcher assignment.
          </span>
        </label>

        <div className="mt-6">
          <Button
            size="lg"
            disabled={!canReview()}
            onClick={() => {
              setAttestationChecked(false);
              setStep("review");
            }}
            className="w-full"
          >
            Review request
          </Button>
        </div>
      </Card>
    );
  }

  // --- Review step ---
  const requestorName =
    customerType === "existing"
      ? selectedResident?.displayName
      : selectedPossibleMatch?.displayName || customerName;
  const requestorPhone =
    customerType === "existing"
      ? selectedResident?.phone ?? null
      : (selectedPossibleMatch?.phone ?? customerPhone.trim()) || null;
  const requestorEmail =
    customerType === "existing"
      ? selectedResident?.email ?? null
      : (selectedPossibleMatch?.email ?? customerEmail.trim()) || null;
  const selectedCircumstances = waterSituation.vulnerableCircumstances.filter((c) => c !== "none");

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Review request</h2>

      <div className="mt-4 flex flex-col gap-3">
        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Requestor</h3>
          <p className="mt-1 text-sm text-slate-900">{requestorName || "—"}</p>
          <p className="text-sm text-slate-600">
            {formatPhoneForDisplay(requestorPhone) ?? "No phone"}
          </p>
          {requestorEmail && (
            <p className="text-sm text-slate-600">{requestorEmail}</p>
          )}
          {customerType === "new" && useExistingResidentUid && (
            <p className="text-xs text-blue-600">Registered account selected.</p>
          )}
          {customerType === "new" && !useExistingResidentUid && (
            <p className="text-xs text-slate-500">Unregistered requestor — no account.</p>
          )}
          {customerType === "new" && sendInvitation && !useExistingResidentUid && (
            <p className="text-xs text-slate-500">Account setup invitation will be sent.</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Delivery location</h3>
          <p className="mt-1 text-sm text-slate-900">{village || "—"}</p>
          <p className="text-sm text-slate-600">{deliveryDirections || "—"}</p>
        </section>

        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Water requested</h3>
          <p className="mt-1 text-sm text-slate-900">{formatWaterQuantity(loads)}</p>
        </section>

        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Preferred driver</h3>
          <p className="mt-1 text-sm text-slate-900">
            {selectedDriver ? selectedDriver.displayName : "No preference"}
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Water situation</h3>
          <dl className="mt-1 space-y-1 text-sm">
            <div>
              <dt className="inline text-slate-500">Urgency:</dt>{" "}
              <dd className="inline text-slate-900">
                {URGENCY_LABEL[waterSituation.reportedUrgency] || "—"}
              </dd>
            </div>
            {selectedCircumstances.length > 0 && (
              <div>
                <dt className="inline text-slate-500">Circumstances:</dt>{" "}
                <dd className="inline text-slate-900">
                  {selectedCircumstances.map((c) => VULNERABLE_LABEL[c] ?? c).join(", ")}
                </dd>
              </div>
            )}
            {waterSituation.personsAffected && (
              <div>
                <dt className="inline text-slate-500">People affected:</dt>{" "}
                <dd className="inline text-slate-900">{waterSituation.personsAffected}</dd>
              </div>
            )}
            {waterSituation.availableStorageCapacity && (
              <div>
                <dt className="inline text-slate-500">Available storage:</dt>{" "}
                <dd className="inline text-slate-900">{waterSituation.availableStorageCapacity}</dd>
              </div>
            )}
            {waterSituation.reportedUrgency === "critical" && (
              <div>
                <dt className="inline text-slate-500">Critical explanation:</dt>{" "}
                <dd className="inline text-slate-900">{waterSituation.criticalExplanation}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      {frequentCount !== null && frequentCount >= 3 && (
        <FrequentRequestWarning count={frequentCount} />
      )}

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
            Phone matching is not identity verification. Only proceed if you have confirmed this is
            a different request.
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

      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="customerType" value={customerType} />
        <input type="hidden" name="loads" value={loads} />
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
        <input
          type="hidden"
          name="linkedResidentUid"
          value={useExistingResidentUid ?? ""}
        />
        <input
          type="hidden"
          name="sendAccountInvitation"
          value={sendInvitation ? "true" : "false"}
        />
        <WaterSituationHiddenFields value={waterSituation} />

        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
          <input
            type="checkbox"
            name="attestationAccepted"
            value="true"
            checked={attestationChecked}
            onChange={(e) => setAttestationChecked(e.target.checked)}
            required
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            I have accurately recorded the information provided by the caller and confirmed it is
            intended for this delivery location.
          </span>
        </label>

        {(state.status !== "duplicate_warning" || overrideDuplicate) && (
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending}
              onClick={() => setStep("form")}
              className="w-full whitespace-nowrap sm:flex-1"
            >
              Go Back
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={pending || !attestationChecked}
              className="w-full whitespace-nowrap sm:flex-1"
            >
              {pending
                ? "Creating\u2026"
                : overrideDuplicate
                  ? "Create anyway"
                  : "Create Request"}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function FrequentRequestWarning({ count }: { count: number }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">Frequent delivery activity</p>
      <p className="text-xs text-amber-800">
        This requestor has had {count} water requests within the last 7 days.
      </p>
    </div>
  );
}

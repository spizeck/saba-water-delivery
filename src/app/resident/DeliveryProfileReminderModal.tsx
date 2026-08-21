"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { DeliveryProfileRequiredField } from "@/lib/domain/deliveryProfileReminder";
import type { UserProfile } from "@/lib/domain/types";

import { confirmDeliveryProfileInfo, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = { status: "idle" };

const FIELD_LABEL: Record<DeliveryProfileRequiredField, string> = {
  phone: "Phone number",
  village: "Village",
  deliveryDirections: "Delivery directions",
};

interface Props {
  profile: UserProfile;
  mandatory: boolean;
  missingFields: DeliveryProfileRequiredField[];
}

/**
 * Periodic (and first-visit / incomplete-profile) reminder asking the
 * resident to confirm their delivery information is still correct — see
 * PRODUCT.md / TECHNICAL.md "Delivery Profile Confirmation Reminder".
 *
 * Only ever rendered by `/resident/page.tsx` when the server-computed
 * `evaluateDeliveryProfileReminder()` result says to show it — this
 * component itself does not decide WHETHER to show, only how, so it
 * naturally never appears on other portals for multi-role users.
 *
 * Structured so a future property/cistern photo review step could be
 * added as another section of this same modal without a redesign — no
 * photo UI is added now (not requested for this task).
 */
export function DeliveryProfileReminderModal({ profile, mandatory, missingFields }: Props) {
  const [open, setOpen] = useState(true);
  const [state, formAction, pending] = useActionState(confirmDeliveryProfileInfo, initialState);

  // Closing (mandatory case: only via "Review My Information", which
  // takes the resident to the profile form) or a successful
  // confirmation both dismiss the modal for this visit. Neither writes
  // anything extra — confirmation already persisted server-side.
  if (!open || state.status === "success") return null;

  function closeAndGoToProfile() {
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-profile-reminder-heading"
      // Backdrop dismissal is only ever a no-op write — never records a
      // confirmation — and is disabled entirely for the mandatory
      // (missing required information) case, per PRODUCT.md.
      onClick={() => {
        if (!mandatory) setOpen(false);
      }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="delivery-profile-reminder-heading"
            className="text-lg font-bold text-slate-900"
          >
            Please confirm your delivery information
          </h2>
          {!mandatory && (
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="shrink-0 text-xl leading-none text-slate-400 hover:text-slate-600"
            >
              &times;
            </button>
          )}
        </div>

        {mandatory ? (
          <p className="text-sm text-slate-600">
            Before requesting water, please complete the following required
            information: <strong>{missingFields.map((f) => FIELD_LABEL[f]).join(", ")}</strong>.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Before requesting water, please make sure your phone number,
            village, and delivery directions are still correct.
          </p>
        )}

        <dl className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Phone</dt>
            <dd className={profile.phone?.trim() ? "text-slate-900" : "font-semibold text-red-700"}>
              {profile.phone?.trim() || "Missing"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Village</dt>
            <dd className={profile.village?.trim() ? "text-slate-900" : "font-semibold text-red-700"}>
              {profile.village?.trim() || "Missing"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Delivery directions</dt>
            <dd
              className={
                profile.deliveryDirections?.trim() ? "text-slate-900" : "font-semibold text-red-700"
              }
            >
              {profile.deliveryDirections?.trim() || "Missing"}
            </dd>
          </div>
        </dl>

        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href="#delivery-profile-form"
            onClick={closeAndGoToProfile}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:flex-1"
          >
            Review My Information
          </a>
          {!mandatory && (
            <form action={formAction} className="w-full sm:flex-1">
              <Button type="submit" size="lg" className="w-full sm:!w-full" disabled={pending}>
                {pending ? "Saving\u2026" : "Everything Is Correct"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";

import { PortalHeader } from "@/components/layout/PortalHeader";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { requireRole } from "@/lib/auth/session";
import { evaluateDeliveryProfileReminder } from "@/lib/domain/deliveryProfileReminder";
import { getEligibleDriverOptions } from "@/lib/domain/driverRegistry";
import { getUserProfile } from "@/lib/domain/users";
import {
  checkDeliveryConfirmationTimeout,
  getActiveRequestForCustomer,
  getMostRecentConfirmedRequest,
  getRequestsForCustomer,
} from "@/lib/domain/waterRequests";

import { ActiveRequest } from "./ActiveRequest";
import { DeliveryProfileReminderModal } from "./DeliveryProfileReminderModal";
import { ProfileForm } from "./ProfileForm";
import { RequestHistory } from "./RequestHistory";
import { WaterRequestForm } from "./WaterRequestForm";

export const metadata: Metadata = {
  title: "Resident — Saba Water Delivery",
};

export default async function ResidentPortalPage() {
  const { uid, profile } = await requireRole("resident");
  const { roles } = profile;
  const profileComplete = Boolean(
    profile.village?.trim() && profile.deliveryDirections?.trim(),
  );

  // Required fields for the delivery-profile confirmation reminder
  // additionally include phone (see PRODUCT.md "Delivery Profile
  // Confirmation Reminder") — deliberately separate from `profileComplete`
  // above, which continues to gate water-request eligibility exactly as
  // before and is NOT changed by this feature.
  const deliveryProfileFieldsComplete = Boolean(
    profile.phone?.trim() && profile.village?.trim() && profile.deliveryDirections?.trim(),
  );

  // Fetch active request and eligible drivers in parallel. The most
  // recent confirmed delivery is only needed when required fields are
  // already complete — if anything is missing the reminder is mandatory
  // regardless, so skip this extra read (see TECHNICAL.md "Delivery
  // Profile Confirmation Reminder" — avoid scanning request history on
  // every login).
  const [rawActiveRequest, eligibleDrivers, allRequests, mostRecentConfirmedRequest] =
    await Promise.all([
      profileComplete ? getActiveRequestForCustomer(uid) : null,
      profileComplete ? getEligibleDriverOptions() : [],
      profileComplete ? getRequestsForCustomer(uid) : [],
      deliveryProfileFieldsComplete ? getMostRecentConfirmedRequest(uid) : null,
    ]);

  const deliveryProfileReminder = evaluateDeliveryProfileReminder({
    phone: profile.phone,
    village: profile.village,
    deliveryDirections: profile.deliveryDirections,
    deliveryProfileConfirmedAt: profile.deliveryProfileConfirmedAt,
    lastConfirmedDeliveryAt: mostRecentConfirmedRequest?.confirmedAt ?? null,
  });

  // Lazy check: if the active request is "delivered", see if the
  // confirmation window has expired — if so it is auto-confirmed here so
  // the resident is never blocked from a new request merely because
  // nobody opened this page in time (see PRODUCT.md "Delivery
  // Confirmation").
  const activeRequest =
    rawActiveRequest?.status === "delivered"
      ? await checkDeliveryConfirmationTimeout(rawActiveRequest.id)
      : rawActiveRequest;

  // Resolve preferred driver name for the active request display.
  let preferredDriverName: string | null = null;
  if (activeRequest?.preferredDriverId) {
    const driverProfile = await getUserProfile(activeRequest.preferredDriverId);
    preferredDriverName = driverProfile?.displayName ?? null;
  }

  // History excludes the currently active request.
  const historyRequests = activeRequest
    ? allRequests.filter((r) => r.id !== activeRequest.id)
    : allRequests;

  return (
    <>
      <PortalHeader portalName="Resident" roles={roles} />
      <main className="flex-1 py-8">
        <Container className="flex flex-col gap-6">
          <Card>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome{profile.displayName ? `, ${profile.displayName}` : ""}
            </h1>
            <p className="mt-2 text-slate-600">
              {profileComplete
                ? "Your delivery information is on file."
                : "Complete your profile below so drivers know where to deliver your water."}
            </p>
          </Card>

          {/* Water request section */}
          {profileComplete ? (
            activeRequest ? (
              <ActiveRequest
                request={activeRequest}
                preferredDriverName={preferredDriverName}
              />
            ) : (
              <WaterRequestForm
                village={profile.village!}
                deliveryDirections={profile.deliveryDirections!}
                eligibleDrivers={eligibleDrivers}
              />
            )
          ) : (
            <Card>
              <h2 className="text-lg font-bold text-slate-900">Request water</h2>
              <p className="mt-2 text-slate-600">
                Complete your profile below to unlock water requests.
              </p>
            </Card>
          )}

          {/* Request history */}
          {profileComplete && historyRequests.length > 0 && (
            <RequestHistory requests={historyRequests} />
          )}

          <div id="delivery-profile-form">
            <ProfileForm profile={profile} />
          </div>
        </Container>
      </main>
      {deliveryProfileReminder.show && (
        <DeliveryProfileReminderModal
          profile={profile}
          mandatory={deliveryProfileReminder.mandatory}
          missingFields={deliveryProfileReminder.missingFields}
          invalidFields={deliveryProfileReminder.invalidFields}
        />
      )}
    </>
  );
}

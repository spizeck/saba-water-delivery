/**
 * Pure decision logic and canonical constants for the versioned driver
 * workflow-change notice (issue #123 follow-up) — same pattern as
 * `deliveryProfileReminder.ts`: no Firestore access, no `server-only`
 * guard, so it is directly unit-testable and safe to import from both
 * server and client components.
 *
 * Why a versioned acknowledgement exists: assignment-on-visibility
 * materially changed the driver workflow — a displayed delivery is
 * already assigned, there is no Accept step, and closing the app does
 * not release it. Drivers are told once per material change via a modal
 * on `/driver`, and the acknowledgement is persisted server-side on
 * their Driver Registry entry (`workflowNoticeAcknowledgedVersion` /
 * `workflowNoticeAcknowledgedAt`, written by
 * `acknowledgeDriverWorkflowNotice()` in `driverRegistry.ts`), so it
 * follows the driver across phones, browsers, and cleared storage.
 *
 * IMPORTANT — education, not authorization: acknowledgement NEVER
 * participates in assignment authority. `assignNextDeliveryForDriver()`
 * does not read these fields; an online, eligible driver who has not
 * acknowledged the notice can still be assigned a delivery. Do not wire
 * this state into dispatch, availability, or cooldown logic.
 *
 * Introducing a future workflow notice:
 *   1. Increment CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION (1 -> 2).
 *   2. Update the modal copy in `src/app/driver/WorkflowNoticeModal.tsx`.
 * Every driver whose stored acknowledged version is lower than the new
 * current version sees the new notice automatically, on every device.
 * Increment ONLY for a material workflow change — never to re-show the
 * same text or fix a typo (edit the copy directly for that).
 */

import { formatSabaDate, sabaCalendarDateKey } from "@/lib/utils/datetime";

/**
 * The one canonical current workflow-notice version. Notice copy lives in
 * `WorkflowNoticeModal.tsx`; bumping this constant is the entire trigger —
 * do not scatter literal version numbers through UI or domain code.
 */
/**
 * v1 (issue #123): assignment-on-visibility — displayed delivery is
 *   already assigned, no Accept step, closing the app does not release.
 * v2 (issue #135): explicit Go Offline releases an ordinary releasable
 *   assignment (decline-accounted); committed work (recorded water
 *   collection) blocks going offline; unattended ordinary assignments
 *   auto-release back to dispatch after 12 hours.
 */
export const CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION = 2;

/**
 * Whether the workflow notice must be shown for a driver whose stored
 * `workflowNoticeAcknowledgedVersion` is `acknowledgedVersion`
 * (`null`/`undefined` for records written before the field existed —
 * treated as 0). A stored version at or above `currentVersion` suppresses
 * the notice; a HIGHER stored version never regresses (e.g. a rollback).
 *
 * `currentVersion` is injectable so tests can simulate a future bump.
 */
export function requiresWorkflowNoticeAcknowledgement(
  acknowledgedVersion: number | null | undefined,
  currentVersion: number = CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
): boolean {
  return (acknowledgedVersion ?? 0) < currentVersion;
}

/**
 * Last Saba-local calendar date (inclusive) on which the temporary
 * "New driver workflow" reinforcement banner renders on `/driver`.
 *
 * The banner is reinforcement only — it is not an acknowledgement
 * control, it gates nothing, and its expiry has no effect on the
 * version-driven acknowledgement modal. Once the assignment-on-visibility
 * workflow is established, remove this constant, this function, and the
 * `WorkflowNoticeBanner` component.
 */
export const DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE = "2026-10-31";

/**
 * Whether the temporary reinforcement banner should render — true through
 * `DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE` (Saba-local), false after.
 * `now` is injectable for deterministic tests.
 */
export function isDriverWorkflowNoticeBannerActive(
  now: Date = new Date(),
): boolean {
  return (
    sabaCalendarDateKey(now) <= DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE
  );
}

/**
 * Compact one-line acknowledgement status for the admin driver-management
 * view, e.g. "Acknowledged v1 — Sep 24, 2026" (current),
 * "Acknowledged v1 — v2 pending" (out of date), or "Not acknowledged".
 */
export function describeWorkflowNoticeAcknowledgement(
  ack: {
    acknowledgedVersion: number;
    acknowledgedAt: string | null;
  },
  currentVersion: number = CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
): string {
  if (
    requiresWorkflowNoticeAcknowledgement(
      ack.acknowledgedVersion,
      currentVersion,
    )
  ) {
    return ack.acknowledgedVersion > 0
      ? `Acknowledged v${ack.acknowledgedVersion} — v${currentVersion} pending`
      : "Not acknowledged";
  }
  return ack.acknowledgedAt
    ? `Acknowledged v${ack.acknowledgedVersion} — ${formatSabaDate(ack.acknowledgedAt)}`
    : `Acknowledged v${ack.acknowledgedVersion}`;
}

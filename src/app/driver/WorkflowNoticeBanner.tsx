/**
 * Temporary reinforcement banner for the assignment-on-visibility
 * workflow change (issue #123 follow-up). Rendered by `/driver/page.tsx`
 * only while `isDriverWorkflowNoticeBannerActive()` — after
 * `DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE` (see
 * `src/lib/domain/driverWorkflowNotice.ts`) it stops rendering entirely.
 * Once the new workflow is established, delete this component, the
 * constant, and the banner check.
 *
 * Reinforcement only — it is not an acknowledgement control and has no
 * interaction with the versioned acknowledgement modal or dispatch.
 */
export function WorkflowNoticeBanner() {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm text-blue-900">
        <strong>New driver workflow:</strong> Deliveries shown here are already
        assigned to you. If you cannot make a delivery, use{" "}
        <strong>Decline / Release Delivery</strong>.
      </p>
    </div>
  );
}

import { describe, expect, it } from "vitest";

import {
  CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
  describeWorkflowNoticeAcknowledgement,
  DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE,
  isDriverWorkflowNoticeBannerActive,
  requiresWorkflowNoticeAcknowledgement,
} from "../driverWorkflowNotice";

/**
 * Unit tests for the pure workflow-notice decision logic (issue #123
 * follow-up). The mutation/concurrency semantics live in
 * `driverWorkflowNotice.emulator.test.ts` (Firestore emulator).
 */

describe("requiresWorkflowNoticeAcknowledgement", () => {
  it("treats a missing acknowledgement (existing records, never seen) as needing the notice", () => {
    expect(requiresWorkflowNoticeAcknowledgement(undefined)).toBe(true);
    expect(requiresWorkflowNoticeAcknowledgement(null)).toBe(true);
  });

  it("treats version 0 as needing the current notice", () => {
    expect(requiresWorkflowNoticeAcknowledgement(0)).toBe(true);
  });

  it("suppresses the notice once the current version is acknowledged", () => {
    expect(
      requiresWorkflowNoticeAcknowledgement(
        CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
      ),
    ).toBe(false);
  });

  it("never regresses when the stored version is ahead of the current constant", () => {
    // e.g. a rollback, or a driver who acknowledged a newer deployment —
    // the stored higher version remains authoritative.
    expect(
      requiresWorkflowNoticeAcknowledgement(
        CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 5,
      ),
    ).toBe(false);
  });

  it("a future version bump re-shows the notice to a driver who acknowledged the previous version", () => {
    const futureVersion = CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1;
    expect(
      requiresWorkflowNoticeAcknowledgement(
        CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
        futureVersion,
      ),
    ).toBe(true);
    // …and a driver who acknowledged the new version stays quiet.
    expect(
      requiresWorkflowNoticeAcknowledgement(futureVersion, futureVersion),
    ).toBe(false);
  });
});

describe("isDriverWorkflowNoticeBannerActive", () => {
  it("is active before and on the last Saba-local banner date", () => {
    expect(isDriverWorkflowNoticeBannerActive(new Date())).toBe(true);
    // Noon UTC is safely inside the intended Saba calendar day.
    const lastDay = new Date(
      `${DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE}T12:00:00Z`,
    );
    expect(isDriverWorkflowNoticeBannerActive(lastDay)).toBe(true);
  });

  it("expires after the last Saba-local banner date", () => {
    const after = new Date(
      `${DRIVER_WORKFLOW_NOTICE_BANNER_LAST_SABA_DATE}T12:00:00Z`,
    );
    after.setUTCDate(after.getUTCDate() + 1);
    expect(isDriverWorkflowNoticeBannerActive(after)).toBe(false);
  });
});

describe("describeWorkflowNoticeAcknowledgement", () => {
  it("reports a driver who has never acknowledged", () => {
    expect(
      describeWorkflowNoticeAcknowledgement({
        acknowledgedVersion: 0,
        acknowledgedAt: null,
      }),
    ).toBe("Not acknowledged");
  });

  it("reports a current acknowledgement with its date", () => {
    const text = describeWorkflowNoticeAcknowledgement({
      acknowledgedVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
      acknowledgedAt: "2026-09-24T15:00:00.000Z",
    });
    expect(text).toBe(
      `Acknowledged v${CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION} — Sep 24, 2026`,
    );
  });

  it("reports a stale acknowledgement as pending the newer current version", () => {
    // Simulates a future bump: a driver who acknowledged v1 sees
    // "v2 pending" once the current version becomes 2.
    const futureVersion = CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1;
    const text = describeWorkflowNoticeAcknowledgement(
      {
        acknowledgedVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION,
        acknowledgedAt: "2026-09-24T15:00:00.000Z",
      },
      futureVersion,
    );
    expect(text).toBe(
      `Acknowledged v${CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION} — v${futureVersion} pending`,
    );
  });

  it("handles an acknowledged version with no timestamp", () => {
    expect(
      describeWorkflowNoticeAcknowledgement({
        acknowledgedVersion: CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1,
        acknowledgedAt: null,
      }),
    ).toBe(`Acknowledged v${CURRENT_DRIVER_WORKFLOW_NOTICE_VERSION + 1}`);
  });
});

import { describe, expect, it } from "vitest";

import type { WaterRequest } from "@/lib/domain/types";
import { processMessage } from "@/lib/whatsapp/conversationSteps";
import type { WhatsAppConversationContext, WhatsAppSession } from "@/lib/whatsapp/types";

function makeSession(overrides: Partial<WhatsAppSession> = {}): WhatsAppSession {
  return {
    id: "session-1",
    senderPhone: "5994165363",
    customerId: null,
    customerType: "unknown",
    step: "menu",
    draft: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<WhatsAppConversationContext> = {}): WhatsAppConversationContext {
  return {
    now: new Date("2026-01-01T12:00:00.000Z"),
    activeRequest: null,
    eligibleDrivers: [],
    registeredProfile: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<WaterRequest> = {}): WaterRequest {
  return {
    id: "req-1",
    customerId: "uid-1",
    customer: null,
    source: "resident",
    createdBy: null,
    loads: 1,
    gallons: 1000,
    village: "Windwardside",
    deliveryDirections: "Blue gate",
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: null,
    status: "requested",
    waterSituation: null,
    attestationAccepted: true,
    attestationAcceptedAt: "2026-01-01T00:00:00.000Z",
    dispatchPriority: "normal",
    prioritySource: "system",
    priorityReason: null,
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
    availableAt: null,
    claimedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dispatchBatchId: null,
    batchSequence: null,
    dispatchOverrideRank: null,
    ...overrides,
  };
}

describe("Start", () => {
  it("shows the welcome menu for a fresh session on a greeting", () => {
    const result = processMessage(makeSession(), "Hi", makeContext());
    expect(result.outbound[0]).toContain("Welcome to Saba Water Delivery");
    expect(result.session?.step).toBe("menu");
  });
});

describe("Request selection", () => {
  it("starts the request conversation for an unregistered customer choosing option 1", () => {
    const session = makeSession({ customerType: "unregistered" });
    const result = processMessage(session, "1", makeContext());
    expect(result.session?.step).toBe("collect_name");
  });

  it("goes to confirm_profile for a uniquely matched registered resident", () => {
    const session = makeSession({ customerType: "registered", customerId: "uid-1" });
    const context = makeContext({
      registeredProfile: {
        displayName: "Jane",
        phone: "5994165363",
        village: "Windwardside",
        deliveryDirections: "Blue gate",
      },
    });
    const result = processMessage(session, "1", context);
    expect(result.session?.step).toBe("confirm_profile");
  });
});

describe("Registered resident match", () => {
  it("does not automatically pick an account for an ambiguous match", () => {
    const session = makeSession({ customerType: "ambiguous" });
    const result = processMessage(session, "1", makeContext());
    expect(result.outbound[0]).toContain("Water Delivery Office");
    expect(result.session?.step).toBe("menu");
    expect(result.actions).toBeUndefined();
  });

  it("proceeds as unregistered when no account matches", () => {
    const session = makeSession({ customerType: "unregistered" });
    const result = processMessage(session, "1", makeContext());
    expect(result.session?.customerType).toBe("unregistered");
    expect(result.session?.step).toBe("collect_name");
  });
});

describe("Village", () => {
  it("accepts a valid canonical village choice", () => {
    const session = makeSession({ step: "collect_village" });
    const result = processMessage(session, "3", makeContext());
    expect(result.session?.step).toBe("collect_directions");
    expect(result.session?.draft.village).toBe("Windwardside");
  });

  it("rejects an arbitrary village and re-prompts", () => {
    const session = makeSession({ step: "collect_village" });
    const result = processMessage(session, "Windwardside", makeContext());
    expect(result.session?.step).toBe("collect_village");
    expect(result.session?.draft.village).toBeUndefined();
  });
});

describe("Critical", () => {
  it("cannot advance past a blank critical explanation", () => {
    const session = makeSession({
      step: "collect_critical_explanation",
      draft: { reportedUrgency: "critical" },
    });
    const result = processMessage(session, "   ", makeContext());
    expect(result.session?.step).toBe("collect_critical_explanation");
  });

  it("advances once a critical explanation is provided", () => {
    const session = makeSession({
      step: "collect_critical_explanation",
      draft: { reportedUrgency: "critical" },
    });
    const result = processMessage(session, "No water left at all", makeContext());
    expect(result.session?.step).toBe("collect_loads");
    expect(result.session?.draft.criticalExplanation).toBe("No water left at all");
  });
});

describe("Quantity", () => {
  it("rejects an invalid load choice and re-prompts", () => {
    const session = makeSession({
      step: "collect_loads",
      draft: { reportedUrgency: "normal" },
    });
    const result = processMessage(session, "3", makeContext());
    expect(result.session?.step).toBe("collect_loads");
    expect(result.outbound[0]).toContain("How much water are you requesting?");
  });

  it("accepts one load and moves to preferred-driver selection", () => {
    const session = makeSession({
      step: "collect_loads",
      draft: { reportedUrgency: "normal" },
    });
    const result = processMessage(session, "1", makeContext());
    expect(result.session?.step).toBe("collect_preferred_driver");
    expect(result.session?.draft.loads).toBe(1);
  });

  it("accepts two loads and moves to preferred-driver selection", () => {
    const session = makeSession({
      step: "collect_loads",
      draft: { reportedUrgency: "normal" },
    });
    const result = processMessage(session, "2", makeContext());
    expect(result.session?.step).toBe("collect_preferred_driver");
    expect(result.session?.draft.loads).toBe(2);
  });

  it("includes the selected quantity on the confirmation summary", () => {
    const session = makeSession({
      step: "collect_loads",
      draft: { reportedUrgency: "normal" },
    });
    const result = processMessage(session, "2", makeContext());
    expect(result.outbound[0]).toContain("Would you like to request a preferred driver?");
  });
});

describe("Confirmation", () => {
  const confirmDraft: WhatsAppSession["draft"] = {
    displayName: "Jane",
    phone: "5994165363",
    village: "Windwardside",
    deliveryDirections: "Blue gate",
    personsAffected: 2,
    vulnerableCircumstances: ["none"],
    reportedUrgency: "normal",
    loads: 1,
    preferredDriverId: null,
  };

  it("does not create a request for anything other than CONFIRM", () => {
    const session = makeSession({
      customerType: "unregistered",
      step: "confirm_request",
      draft: { ...confirmDraft },
    });
    const result = processMessage(session, "yes", makeContext());
    expect(result.actions).toBeUndefined();
    expect(result.session?.step).toBe("confirm_request");
  });

  it("cancels without creating a request on CANCEL", () => {
    const session = makeSession({
      customerType: "unregistered",
      step: "confirm_request",
      draft: { ...confirmDraft },
    });
    const result = processMessage(session, "CANCEL", makeContext());
    expect(result.actions).toBeUndefined();
    expect(result.session?.step).toBe("menu");
    expect(result.session?.draft).toEqual({});
  });

  it("returns exactly one create_request action on CONFIRM for an unregistered customer", () => {
    const session = makeSession({
      customerType: "unregistered",
      step: "confirm_request",
      draft: { ...confirmDraft },
    });
    const result = processMessage(session, "CONFIRM", makeContext());
    expect(result.actions).toHaveLength(1);
    expect(result.actions?.[0]).toMatchObject({
      type: "create_request",
      customerId: null,
      customer: { displayName: "Jane", phone: "5994165363", email: null },
      village: "Windwardside",
    });
    expect(result.session?.step).toBe("menu");
  });

  it("returns exactly one create_request action on CONFIRM for a registered resident (no profile edit)", () => {
    const session = makeSession({
      customerType: "registered",
      customerId: "uid-1",
      step: "confirm_request",
      draft: { ...confirmDraft, editingProfile: false },
    });
    const result = processMessage(session, "CONFIRM", makeContext());
    expect(result.actions).toHaveLength(1);
    expect(result.actions?.[0]).toMatchObject({ type: "create_request", customerId: "uid-1", customer: null });
  });

  it("returns an update_profile action before create_request when the resident confirmed an edit", () => {
    const session = makeSession({
      customerType: "registered",
      customerId: "uid-1",
      step: "confirm_request",
      draft: { ...confirmDraft, editingProfile: true },
    });
    const result = processMessage(session, "CONFIRM", makeContext());
    expect(result.actions).toHaveLength(2);
    expect(result.actions?.[0].type).toBe("update_profile");
    expect(result.actions?.[1].type).toBe("create_request");
  });
});

describe("Existing request", () => {
  it("blocks a new request and reports current status when one is already active", () => {
    const session = makeSession({ customerType: "registered", customerId: "uid-1" });
    const context = makeContext({ activeRequest: makeRequest({ status: "claimed" }) });
    const result = processMessage(session, "1", context);
    expect(result.actions).toBeUndefined();
    expect(result.session?.step).toBe("menu");
    expect(result.outbound.join(" ")).toContain("already have an active");
    expect(result.outbound.join(" ")).toContain("Driver assigned");
  });

  it("reports 'check my current request' status for a registered resident", () => {
    const session = makeSession({ customerType: "registered", customerId: "uid-1" });
    const context = makeContext({ activeRequest: makeRequest({ status: "available" }) });
    const result = processMessage(session, "2", context);
    expect(result.outbound.join(" ")).toContain("Waiting for a driver");
  });

  it("reports no active request when there is none", () => {
    const session = makeSession({ customerType: "registered", customerId: "uid-1" });
    const result = processMessage(session, "2", makeContext({ activeRequest: null }));
    expect(result.outbound[0]).toContain("do not have an active water request");
  });
});

describe("Delivery confirmation", () => {
  it("returns a confirm_delivery action on Yes for a delivered request", () => {
    const session = makeSession({
      customerType: "registered",
      customerId: "uid-1",
      step: "confirm_delivery",
      draft: { activeRequestId: "req-1" },
    });
    const result = processMessage(session, "1", makeContext());
    expect(result.actions).toEqual([{ type: "confirm_delivery", requestId: "req-1", customerId: "uid-1" }]);
    expect(result.session?.step).toBe("menu");
  });

  it("transitions into confirm_delivery automatically when status check finds a delivered request", () => {
    const session = makeSession({ customerType: "registered", customerId: "uid-1" });
    const context = makeContext({ activeRequest: makeRequest({ status: "delivered" }) });
    const result = processMessage(session, "2", context);
    expect(result.session?.step).toBe("confirm_delivery");
    expect(result.session?.draft.activeRequestId).toBe("req-1");
    expect(result.outbound.join(" ")).toContain("Did you receive your 1 load (1,000 gallons)?");
  });
});

describe("Dispute", () => {
  it("collects a reason and returns a dispute_delivery action", () => {
    const askReason = processMessage(
      makeSession({
        customerType: "registered",
        customerId: "uid-1",
        step: "confirm_delivery",
        draft: { activeRequestId: "req-1" },
      }),
      "2",
      makeContext(),
    );
    expect(askReason.session?.step).toBe("collect_dispute_reason");

    const disputeResult = processMessage(askReason.session!, "Never arrived", makeContext());
    expect(disputeResult.actions).toEqual([
      { type: "dispute_delivery", requestId: "req-1", customerId: "uid-1", reason: "Never arrived" },
    ]);
    expect(disputeResult.session?.step).toBe("menu");
  });

  it("does not accept a blank dispute reason", () => {
    const session = makeSession({
      customerType: "registered",
      customerId: "uid-1",
      step: "collect_dispute_reason",
      draft: { activeRequestId: "req-1" },
    });
    const result = processMessage(session, "   ", makeContext());
    expect(result.actions).toBeUndefined();
    expect(result.session?.step).toBe("collect_dispute_reason");
  });
});

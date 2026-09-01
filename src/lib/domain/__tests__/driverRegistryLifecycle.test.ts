import { describe, expect, it, vi } from "vitest";

import {
  getActiveDriverRegistryEntries,
  getArchivedDriverRegistryEntries,
  getEligibleDriverOptions,
} from "@/lib/domain/driverRegistry";

const activeDoc = {
  id: "active-1",
  data: () => ({
    displayName: "Active Driver",
    phone: null,
    linkedUserId: "user-1",
    eligibilityStatus: "eligible",
    availabilityStatus: "online",
    ineligibilityReason: null,
    restrictedAt: null,
    restrictedBy: null,
    cooldownUntil: null,
    activeRequestId: null,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    archivedPreviousEligibilityStatus: null,
    archivedPreviousIneligibilityReason: null,
    createdAt: { toDate: () => new Date("2026-01-01") },
    createdBy: "admin-1",
    updatedAt: { toDate: () => new Date("2026-01-01") },
    updatedBy: "admin-1",
  }),
};

const archivedDoc = {
  id: "archived-1",
  data: () => ({
    displayName: "Archived Driver",
    phone: null,
    linkedUserId: null,
    eligibilityStatus: "ineligible",
    availabilityStatus: "offline",
    ineligibilityReason: "Archived: retired",
    restrictedAt: null,
    restrictedBy: null,
    cooldownUntil: null,
    activeRequestId: null,
    archivedAt: { toDate: () => new Date("2026-02-01") },
    archivedBy: "admin-1",
    archiveReason: "retired",
    archivedPreviousEligibilityStatus: "eligible",
    archivedPreviousIneligibilityReason: null,
    createdAt: { toDate: () => new Date("2026-01-01") },
    createdBy: "admin-1",
    updatedAt: { toDate: () => new Date("2026-02-01") },
    updatedBy: "admin-1",
  }),
};

const fakeSnapshot = {
  docs: [activeDoc, archivedDoc],
};

const fakeDb = {
  collection: (_name: string) => ({
    get: vi.fn(() => Promise.resolve(fakeSnapshot)),
  }),
};

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => fakeDb,
}));

describe("driver registry lifecycle views", () => {
  it("active view excludes archived drivers", async () => {
    const active = await getActiveDriverRegistryEntries();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("active-1");
    expect(active[0].archivedAt).toBeNull();
  });

  it("archived view includes only archived drivers", async () => {
    const archived = await getArchivedDriverRegistryEntries();
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("archived-1");
    expect(archived[0].archivedAt).not.toBeNull();
  });

  it("eligible-driver options exclude archived and unlinked drivers", async () => {
    const options = await getEligibleDriverOptions();
    expect(options).toHaveLength(1);
    expect(options[0].uid).toBe("user-1");
  });
});

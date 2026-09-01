import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const projectId = "saba-water-delivery-rules-test";
let testEnv: RulesTestEnvironment;

const user = (roles: string[]) => ({
  displayName: "Test User",
  email: "test@example.com",
  phone: "+599 000 0000",
  roles,
  village: "The Bottom",
  deliveryDirections: "Blue house",
  deliveryProfileConfirmedAt: null,
  accountOrigin: "self_registered",
  authStatus: "claimed",
  createdAt: new Date(),
  updatedAt: new Date(),
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
    storage: {
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/resident-a"), user(["resident"])),
      setDoc(doc(db, "users/resident-b"), user(["resident"])),
      setDoc(doc(db, "users/driver-a"), user(["resident", "driver"])),
      setDoc(doc(db, "users/viewer-a"), user(["viewer"])),
      setDoc(doc(db, "users/dispatcher-a"), user(["dispatcher"])),
      setDoc(doc(db, "users/admin-a"), user(["admin"])),
      setDoc(doc(db, "waterRequests/request-a"), {
        customerId: "resident-a",
        assignedDriverId: "driver-a",
        customer: { displayName: "Resident A", phone: "111", email: "a@example.com" },
        status: "claimed",
        village: "The Bottom",
      }),
      setDoc(doc(db, "waterRequests/request-b"), {
        customerId: "resident-b",
        assignedDriverId: null,
        customer: { displayName: "Resident B", phone: "222", email: "b@example.com" },
        status: "available",
        village: "St Johns",
      }),
      setDoc(doc(db, "waterRequests/request-a/events/event-a"), {
        type: "request_edited",
        actorId: "dispatcher-a",
        metadata: { customerPhone: { from: "000", to: "111" } },
      }),
      setDoc(doc(db, "waterRequests/request-a/photos/photo-a"), { path: "request-photos/request-a/photo-a" }),
      setDoc(doc(db, "users/resident-a/propertyPhotos/photo-a"), { path: "property-photos/resident-a/photo-a" }),
      setDoc(doc(db, "driverRegistry/registry-a"), {
        displayName: "Driver A",
        phone: "333",
        linkedUserId: "driver-a",
      }),
      setDoc(doc(db, "driverRegistry/registry-a/events/event-a"), { type: "driver_online" }),
      setDoc(doc(db, "driverRegistry/registry-a/meters/station-a"), { meterCode: "42" }),
      setDoc(doc(db, "driverRegistryUniqueKeys/name-key"), { driverId: "registry-a" }),
      setDoc(doc(db, "fillStations/station-a"), { name: "Bottom Fill Station", active: true }),
      setDoc(doc(db, "driverOffers/offer-a"), { driverId: "driver-a", requestId: "request-a" }),
      setDoc(doc(db, "config/dispatch"), { offerTimeoutSeconds: 60 }),
      setDoc(doc(db, "config/dispatch/events/event-a"), { type: "settings_updated" }),
      setDoc(doc(db, "dispatchBatches/batch-a"), { driverId: "driver-a", status: "active" }),
      setDoc(doc(db, "dispatchBatches/batch-a/events/event-a"), { type: "batch_created" }),
      setDoc(doc(db, "whatsappSessions/session-a"), { step: "village" }),
      setDoc(doc(db, "whatsappProcessedMessages/message-a"), { processedAt: new Date() }),
      setDoc(doc(db, "accountMergeEvents/merge-a"), { actorId: "admin-a" }),
      setDoc(doc(db, "unknownCollection/unknown-a"), { secret: true }),
    ]);
  });
}

const dbFor = (uid?: string) =>
  uid ? testEnv.authenticatedContext(uid).firestore() : testEnv.unauthenticatedContext().firestore();

describe("signed out", () => {
  it("cannot read or write operational data", async () => {
    await seed();
    const db = dbFor();
    await assertFails(getDoc(doc(db, "users/resident-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a")));
    await assertFails(getDoc(doc(db, "fillStations/station-a")));
    await assertFails(setDoc(doc(db, "waterRequests/new-request"), { status: "available" }));
  });
});

describe("resident", () => {
  it("reads only their own profile", async () => {
    await seed();
    const db = dbFor("resident-a");
    await assertSucceeds(getDoc(doc(db, "users/resident-a")));
    await assertFails(getDoc(doc(db, "users/resident-b")));
  });

  it("updates only the explicit resident profile allowlist", async () => {
    await seed();
    const db = dbFor("resident-a");
    await assertSucceeds(updateDoc(doc(db, "users/resident-a"), {
      displayName: "Corrected Name",
      phone: "444",
      village: "Windwardside",
      deliveryDirections: "Green gate",
    }));
    await assertFails(updateDoc(doc(db, "users/resident-a"), { roles: ["admin"] }));
    await assertFails(updateDoc(doc(db, "users/resident-a"), { authStatus: "unclaimed" }));
    await assertFails(updateDoc(doc(db, "users/resident-a"), { unexpectedPrivilegedField: true }));
    await assertFails(updateDoc(doc(db, "users/resident-a"), { deliveryProfileConfirmedAt: new Date() }));
    await assertFails(setDoc(doc(db, "users/new-user"), user(["resident"])));
  });

  it("reads only owned requests and only with a rule-compatible query", async () => {
    await seed();
    const db = dbFor("resident-a");
    await assertSucceeds(getDoc(doc(db, "waterRequests/request-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-b")));
    await assertSucceeds(getDocs(query(collection(db, "waterRequests"), where("customerId", "==", "resident-a"))));
    await assertFails(getDocs(collection(db, "waterRequests")));
  });

  it("cannot mutate requests or read raw audit/photo metadata", async () => {
    await seed();
    const db = dbFor("resident-a");
    await assertFails(updateDoc(doc(db, "waterRequests/request-a"), { status: "confirmed" }));
    await assertFails(deleteDoc(doc(db, "waterRequests/request-a")));
    await assertFails(addDoc(collection(db, "waterRequests"), { customerId: "resident-a" }));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/events/event-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/photos/photo-a")));
    await assertFails(getDoc(doc(db, "users/resident-a/propertyPhotos/photo-a")));
  });
});

describe("driver", () => {
  it("reads an assigned request but not unrelated requests or resident profiles", async () => {
    await seed();
    const db = dbFor("driver-a");
    await assertSucceeds(getDoc(doc(db, "waterRequests/request-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-b")));
    await assertFails(getDoc(doc(db, "users/resident-a")));
  });

  it("cannot mutate requests or read raw audit, photo, registry, or offer data", async () => {
    await seed();
    const db = dbFor("driver-a");
    await assertFails(updateDoc(doc(db, "waterRequests/request-a"), { status: "delivered" }));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/events/event-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/photos/photo-a")));
    await assertFails(getDoc(doc(db, "driverRegistry/registry-a")));
    await assertFails(getDoc(doc(db, "driverOffers/offer-a")));
  });
});

describe("viewer", () => {
  it("cannot retrieve raw PII or internal operational records", async () => {
    await seed();
    const db = dbFor("viewer-a");
    await assertSucceeds(getDoc(doc(db, "users/viewer-a")));
    await assertFails(getDoc(doc(db, "users/resident-a")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a")));
    await assertFails(getDocs(collection(db, "waterRequests")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/events/event-a")));
    await assertFails(getDoc(doc(db, "driverRegistry/registry-a")));
    await assertFails(getDoc(doc(db, "driverRegistry/registry-a/events/event-a")));
    await assertFails(getDoc(doc(db, "driverRegistry/registry-a/meters/station-a")));
    await assertFails(getDoc(doc(db, "dispatchBatches/batch-a")));
  });

  it("cannot mutate any operational record", async () => {
    await seed();
    const db = dbFor("viewer-a");
    await assertFails(updateDoc(doc(db, "waterRequests/request-a"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(db, "driverRegistry/registry-a"), { eligibilityStatus: "eligible" }));
    await assertFails(updateDoc(doc(db, "config/dispatch"), { offerTimeoutSeconds: 1 }));
  });
});

describe.each(["dispatcher-a", "admin-a"])("staff role %s", (uid) => {
  it("has intended reads but cannot bypass server mutation workflows", async () => {
    await seed();
    const db = dbFor(uid);
    await assertSucceeds(getDoc(doc(db, "users/resident-a")));
    await assertSucceeds(getDoc(doc(db, "waterRequests/request-a")));
    await assertSucceeds(getDoc(doc(db, "waterRequests/request-a/events/event-a")));
    await assertSucceeds(getDoc(doc(db, "driverRegistry/registry-a")));
    await assertSucceeds(getDoc(doc(db, "driverRegistry/registry-a/events/event-a")));
    await assertSucceeds(getDoc(doc(db, "driverRegistry/registry-a/meters/station-a")));
    await assertSucceeds(getDoc(doc(db, "driverOffers/offer-a")));
    await assertSucceeds(getDoc(doc(db, "config/dispatch")));
    await assertSucceeds(getDoc(doc(db, "config/dispatch/events/event-a")));
    await assertSucceeds(getDoc(doc(db, "dispatchBatches/batch-a")));
    await assertSucceeds(getDoc(doc(db, "dispatchBatches/batch-a/events/event-a")));
    await assertFails(updateDoc(doc(db, "users/resident-a"), { roles: ["admin"] }));
    await assertFails(updateDoc(doc(db, "waterRequests/request-a"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(db, "driverRegistry/registry-a"), { eligibilityStatus: "eligible" }));
    await assertFails(updateDoc(doc(db, "config/dispatch"), { offerTimeoutSeconds: 1 }));
    await assertFails(updateDoc(doc(db, "dispatchBatches/batch-a"), { status: "completed" }));
  });
});

describe("locked collections and catch-all", () => {
  it("denies private server-only, uniqueness, photo, and unknown collections", async () => {
    await seed();
    const db = dbFor("admin-a");
    await assertFails(getDoc(doc(db, "whatsappSessions/session-a")));
    await assertFails(getDoc(doc(db, "whatsappProcessedMessages/message-a")));
    await assertFails(getDoc(doc(db, "accountMergeEvents/merge-a")));
    await assertFails(getDoc(doc(db, "driverRegistryUniqueKeys/name-key")));
    await assertFails(getDoc(doc(db, "waterRequests/request-a/photos/photo-a")));
    await assertFails(getDoc(doc(db, "users/resident-a/propertyPhotos/photo-a")));
    await assertFails(getDoc(doc(db, "unknownCollection/unknown-a")));
    await assertFails(setDoc(doc(db, "unknownCollection/new-doc"), { value: true }));
  });

  it("allows signed-in users to read fill-station reference data but never write it", async () => {
    await seed();
    const db = dbFor("resident-a");
    await assertSucceeds(getDoc(doc(db, "fillStations/station-a")));
    await assertFails(updateDoc(doc(db, "fillStations/station-a"), { active: false }));
  });
});

describe("Storage deny-all", () => {
  it.each([undefined, "resident-a", "driver-a", "viewer-a", "dispatcher-a", "admin-a"])(
    "denies reads and writes for %s",
    async (uid) => {
      await seed();
      const context = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
      const storage = context.storage();
      await assertFails(storage.ref("property-photos/resident-a/photo-a").getDownloadURL());
      await assertFails(storage.ref("property-photos/resident-a/photo-a").putString("photo") as unknown as Promise<unknown>);
      await assertFails(storage.ref("request-photos/request-a/photo-a").getDownloadURL());
      await assertFails(storage.ref("request-photos/request-a/photo-a").putString("photo") as unknown as Promise<unknown>);
      await assertFails(storage.ref("unknown/path").getDownloadURL());
      await assertFails(storage.ref("unknown/path").putString("data") as unknown as Promise<unknown>);
    },
  );
});

/**
 * Deterministic emulator seeding for the E2E suite (issue #34).
 *
 * All writes go through the Firebase Admin SDK against the LOCAL emulators
 * (guaranteed by `assertEmulatorSafety()`), never production. Helpers create
 * exactly the minimum state a test needs: auth users, resident/staff profiles,
 * the Driver Registry entry + meter, fill stations, water requests, and
 * delivery runs. Business logic lives in the application, not here — these
 * helpers only write plain documents in the shapes documented in TECHNICAL.md.
 *
 * Test independence: baseline accounts/fill stations/registry are seeded once
 * in global setup; per-test state (water requests, runs) is created with unique
 * ids so tests never collide and never depend on ordering.
 */

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  E2E_ACCOUNTS,
  E2E_CANONICAL_VILLAGE,
  E2E_DEFAULT_STATION_ID,
  E2E_DRIVER_REGISTRY_ID,
  E2E_PROJECT_ID,
  type E2eAccount,
} from "./config";
import { assertEmulatorSafety } from "./safety";

let app: App | null = null;

function adminApp(): App {
  assertEmulatorSafety();
  if (!app) {
    app = getApps()[0] ?? initializeApp({ projectId: E2E_PROJECT_ID });
  }
  return app;
}

export function db(): Firestore {
  return getFirestore(adminApp());
}

function auth() {
  return getAuth(adminApp());
}

// ---------------------------------------------------------------------------
// Emulator reset (REST API — no Java, no SDK dependency)
// ---------------------------------------------------------------------------

/** Deletes every Firestore document in the emulator. */
export async function clearFirestore(): Promise<void> {
  assertEmulatorSafety();
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator: ${res.status}`);
  }
}

/** Deletes every account in the Auth emulator. */
export async function clearAuthUsers(): Promise<void> {
  assertEmulatorSafety();
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`Failed to clear Auth emulator: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Baseline seed (users, fill stations, driver registry)
// ---------------------------------------------------------------------------

async function seedAuthUser(account: E2eAccount): Promise<void> {
  try {
    await auth().createUser({
      uid: account.uid,
      email: account.email,
      password: account.password,
      displayName: account.displayName,
      emailVerified: true,
    });
  } catch (error) {
    // Idempotent: ignore "already exists" so re-runs against a warm emulator
    // don't fail.
    const code = (error as { code?: string }).code ?? "";
    if (!code.includes("already-exists") && !code.includes("email-already")) {
      throw error;
    }
  }
}

interface ProfileOptions {
  village?: string | null;
  deliveryDirections?: string | null;
  phone?: string | null;
}

export async function seedUserProfile(
  account: E2eAccount,
  options: ProfileOptions = {},
): Promise<void> {
  const now = new Date();
  await db()
    .collection("users")
    .doc(account.uid)
    .set({
      uid: account.uid,
      displayName: account.displayName,
      email: account.email,
      phone: options.phone ?? "+599 416 0000",
      roles: account.roles,
      village: options.village ?? null,
      deliveryDirections: options.deliveryDirections ?? null,
      deliveryProfileConfirmedAt: now,
      accountOrigin: "self_registered",
      authStatus: "claimed",
      createdAt: now,
      updatedAt: now,
    });
}

export async function seedFillStations(): Promise<void> {
  const stations = [
    { id: "bottom", name: "Bottom Fill Station", active: true },
    { id: "wws", name: "W.W.S. Fill Station", active: true },
    { id: "hells-gate", name: "Hells Gate Fill Station", active: true },
  ];
  await Promise.all(
    stations.map((s) =>
      db()
        .collection("fillStations")
        .doc(s.id)
        .set({ name: s.name, active: s.active }),
    ),
  );
}

/**
 * Seeds the Driver Registry entry linked to the driver test account, online +
 * eligible, with a meter at the default fill station so the driver can record
 * collection.
 */
export async function seedDriverRegistry(): Promise<void> {
  const now = new Date();
  const driver = E2E_ACCOUNTS.driver;
  const ref = db().collection("driverRegistry").doc(E2E_DRIVER_REGISTRY_ID);
  await ref.set({
    displayName: driver.displayName,
    phone: "+599 416 1111",
    linkedUserId: driver.uid,
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
    createdAt: now,
    createdBy: E2E_ACCOUNTS.admin.uid,
    updatedAt: now,
    updatedBy: E2E_ACCOUNTS.admin.uid,
  });
  await ref.collection("meters").doc(E2E_DEFAULT_STATION_ID).set({
    stationId: E2E_DEFAULT_STATION_ID,
    meterCode: "BTM1",
    meterNumber: 1,
    updatedAt: now,
    updatedBy: E2E_ACCOUNTS.admin.uid,
  });
}

/**
 * Resets Firestore to the seeded baseline between tests (auth accounts are left
 * intact so login keeps working). Gives each test a clean, deterministic slate
 * without depending on execution order — the resident's one-active-request
 * constraint, the driver's claimed deliveries, and delivery runs all start
 * empty.
 */
export async function resetToBaseline(): Promise<void> {
  await clearFirestore();
  await seedBaseline();
}

/** Seeds all baseline accounts (auth + profile), fill stations and registry. */
export async function seedBaseline(): Promise<void> {
  await seedAuthUser(E2E_ACCOUNTS.resident);
  await seedAuthUser(E2E_ACCOUNTS.driver);
  await seedAuthUser(E2E_ACCOUNTS.dispatcher);
  await seedAuthUser(E2E_ACCOUNTS.admin);

  await seedUserProfile(E2E_ACCOUNTS.resident, {
    village: E2E_CANONICAL_VILLAGE,
    deliveryDirections:
      "Blue gate opposite the church, second house on the left.",
    phone: "+599 416 2222",
  });
  await seedUserProfile(E2E_ACCOUNTS.driver);
  await seedUserProfile(E2E_ACCOUNTS.dispatcher);
  await seedUserProfile(E2E_ACCOUNTS.admin);

  await seedFillStations();
  await seedDriverRegistry();
}

// ---------------------------------------------------------------------------
// Per-test state: water requests and delivery runs
// ---------------------------------------------------------------------------

export interface SeedRequestOptions {
  status?: string;
  loads?: 1 | 2;
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string | null;
  /** Defaults to "resident"; pass "dispatcher" for staff-entered requests
   * (required when `customerId` is null — see TECHNICAL.md
   * "Dispatcher-Created Requests"). */
  source?: "resident" | "dispatcher" | "whatsapp";
  /** uid of the staff member who entered the request (dispatcher-sourced only). */
  createdBy?: string | null;
  village?: string;
  deliveryDirections?: string;
  assignedDriverId?: string | null;
  dispatchBatchId?: string | null;
  batchSequence?: number | null;
  loadCollections?: unknown[] | null;
  requestNotes?: string | null;
  deliveredAt?: Date | null;
}

/**
 * Creates a `waterRequests/{id}` document in the given state and returns its id.
 * Fields default to a valid registered-resident request; override only what the
 * test needs.
 */
export async function seedWaterRequest(
  options: SeedRequestOptions = {},
): Promise<string> {
  const now = new Date();
  const loads = options.loads ?? 1;
  const status = options.status ?? "requested";
  const customerId =
    options.customerId === undefined
      ? E2E_ACCOUNTS.resident.uid
      : options.customerId;

  const ref = db().collection("waterRequests").doc();
  await ref.set({
    customerId,
    customer: {
      displayName: options.customerName ?? E2E_ACCOUNTS.resident.displayName,
      phone: options.customerPhone ?? "+599 416 2222",
      email: customerId ? E2E_ACCOUNTS.resident.email : null,
      isRegistered: customerId !== null,
    },
    source: options.source ?? "resident",
    createdBy: options.createdBy ?? null,
    loads,
    gallons: loads * 1000,
    village: options.village ?? E2E_CANONICAL_VILLAGE,
    deliveryDirections:
      options.deliveryDirections ?? "Blue gate opposite the church.",
    requestNotes: options.requestNotes ?? null,
    preferredDriverId: null,
    preferredDriverExpiresAt: null,
    assignedDriverId: options.assignedDriverId ?? null,
    status,
    waterSituation: {
      personsAffected: 3,
      vulnerableCircumstances: ["none"],
      availableStorageCapacity: "Low",
      reportedUrgency: "normal",
      criticalExplanation: null,
    },
    attestationAccepted: true,
    attestationAcceptedAt: now,
    dispatchPriority: "normal",
    prioritySource: "system",
    priorityReason: "Initial system determination.",
    priorityUpdatedBy: null,
    priorityUpdatedAt: null,
    requestedAt: now,
    availableAt: status === "available" ? now : null,
    claimedAt: ["claimed", "delivered", "confirmed", "disputed"].includes(
      status,
    )
      ? now
      : null,
    deliveredAt:
      options.deliveredAt ??
      (["delivered", "confirmed", "disputed"].includes(status) ? now : null),
    confirmedAt: status === "confirmed" ? now : null,
    createdAt: now,
    updatedAt: now,
    dispatchBatchId: options.dispatchBatchId ?? null,
    batchSequence: options.batchSequence ?? null,
    dispatchOverrideRank: null,
    loadCollections: options.loadCollections ?? null,
  });
  return ref.id;
}

/** A single recorded load-collection entry, for seeding partially/fully collected requests. */
export function collectionEntry(loadNumber: 1 | 2, driverUid: string) {
  return {
    loadNumber,
    collectedAt: new Date(),
    fillStationId: E2E_DEFAULT_STATION_ID,
    fillStationName: "Bottom Fill Station",
    meterCode: "BTM1",
    meterNumber: 1,
    driverId: driverUid,
    recordedBy: driverUid,
    recordedByRole: "driver",
    note: null,
  };
}

/** Allocates a fresh delivery-run id up front so member requests can reference it. */
export function newDispatchBatchId(): string {
  return db().collection("dispatchBatches").doc().id;
}

export interface SeedBatchOptions {
  /** Explicit id (from `newDispatchBatchId()`) so requests can be linked first. */
  id?: string;
  driverId?: string;
  requestIds: string[];
  status?: "active" | "completed";
}

/** Creates a `dispatchBatches/{id}` delivery run and returns its id. */
export async function seedDispatchBatch(
  options: SeedBatchOptions,
): Promise<string> {
  const now = new Date();
  const driverId = options.driverId ?? E2E_ACCOUNTS.driver.uid;
  const ref = options.id
    ? db().collection("dispatchBatches").doc(options.id)
    : db().collection("dispatchBatches").doc();
  await ref.set({
    driverId,
    driverDisplayName: E2E_ACCOUNTS.driver.displayName,
    createdBy: E2E_ACCOUNTS.dispatcher.uid,
    createdAt: now,
    status: options.status ?? "active",
    originalRequestIds: options.requestIds,
    generatedAt: null,
    updatedAt: now,
  });
  return ref.id;
}

/** Reads a water request document (raw data) — for direct persistence assertions. */
export async function getRequestData(
  requestId: string,
): Promise<Record<string, unknown> | undefined> {
  const snap = await db().collection("waterRequests").doc(requestId).get();
  return snap.data();
}

/**
 * Reads the audit events recorded under a request (`waterRequests/{id}/events`),
 * optionally filtered by `type`. Used to assert that a UI action persisted the
 * canonical event and metadata (e.g. the dispute reason) — never to mutate.
 */
export async function getRequestEvents(
  requestId: string,
  type?: string,
): Promise<Record<string, unknown>[]> {
  const snap = await db()
    .collection("waterRequests")
    .doc(requestId)
    .collection("events")
    .get();
  const events = snap.docs.map((doc) => doc.data());
  return type ? events.filter((e) => e.type === type) : events;
}

/**
 * Returns the most recent water request for a customer (raw data + id), or null.
 * Used by tests to assert that a UI submission persisted the expected Firestore
 * state without needing to know the generated request id.
 */
export async function getLatestRequestForCustomer(
  customerId: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const snap = await db()
    .collection("waterRequests")
    .where("customerId", "==", customerId)
    .get();
  if (snap.empty) return null;
  const docs = snap.docs.sort((a, b) => {
    const at =
      (a.data().requestedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const bt =
      (b.data().requestedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return bt - at;
  });
  return { id: docs[0].id, data: docs[0].data() };
}

/** Reads a user profile document (raw data) — for direct persistence assertions. */
export async function getUserProfileData(
  uid: string,
): Promise<Record<string, unknown> | undefined> {
  const snap = await db().collection("users").doc(uid).get();
  return snap.data();
}

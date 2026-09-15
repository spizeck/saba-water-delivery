import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A mutable cookie jar lets getSessionUser's `next/headers` dependency serve
// a real emulator-issued session cookie inside a plain vitest process.
const cookieJar = vi.hoisted(() => ({ session: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session" && cookieJar.session
        ? { value: cookieJar.session }
        : undefined,
  }),
}));

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { mergeUserAccounts } from "@/lib/domain/identity";
import {
  adminMergeAuthOps,
  MERGE_EVENTS_COLLECTION,
  processMergeAuthReconciliation,
  type MergeAuthOps,
} from "@/lib/domain/mergeReconciliation";
import { getSessionUser } from "@/lib/auth/session";
import { POST } from "@/app/api/auth/session/route";
import type { UserRole } from "@/lib/domain/types";

/**
 * REAL Auth-emulator coverage for account-merge Auth reconciliation
 * (issue #73). Unlike mergeReconciliation.emulator.test.ts (which injects a
 * fake Auth to isolate the state machine), these tests create REAL Auth
 * emulator users and observe real getUser/updateUser/revokeRefreshTokens/
 * deleteUser behavior — plus the session boundary end to end: a real
 * emulator-issued ID token exchanged through the real POST /api/auth/session
 * route, and a real session cookie verified by the real
 * verifySessionCookie(cookie, true) path inside getSessionUser.
 *
 * Runs only under `npm run test:auth-emulator` (Auth + Firestore emulators,
 * demo project — never production).
 */

const db = getAdminDb();
const auth = getAdminAuth();
const USERS = "users";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const PROJECT = "demo-saba-water-delivery";
const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);
const ZERO_JITTER = () => 0.5;

async function clearState(): Promise<void> {
  for (const c of [USERS, MERGE_EVENTS_COLLECTION]) {
    await db.recursiveDelete(db.collection(c));
  }
  // Wipe all emulator Auth users (demo project; the CLI safety wrapper is the
  // `firebase emulators:exec` invocation, and this REST endpoint is the
  // documented emulator reset).
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: "DELETE",
  });
  cookieJar.session = null;
}

async function seedUser(uid: string, roles: UserRole[] = ["resident"]) {
  await db
    .collection(USERS)
    .doc(uid)
    .set({
      displayName: `Name ${uid}`,
      email: `${uid}@example.test`,
      phone: null,
      roles,
      authStatus: "claimed",
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE),
    });
}

async function createAuthUser(
  uid: string,
  email: string,
  password = "password-1",
) {
  await auth.createUser({ uid, email, password });
}

async function authUserState(
  uid: string,
): Promise<{ exists: boolean; disabled: boolean }> {
  try {
    const record = await auth.getUser(uid);
    return { exists: true, disabled: record.disabled };
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") {
      return { exists: false, disabled: false };
    }
    throw error;
  }
}

/** Real emulator sign-in → ID token (the same artifact a browser holds). */
async function signInIdToken(email: string, password: string): Promise<string> {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string; error?: unknown };
  if (!res.ok || !body.idToken) {
    throw new Error(`emulator sign-in failed: ${JSON.stringify(body.error)}`);
  }
  return body.idToken;
}

function sessionRequest(idToken: string): NextRequest {
  return new NextRequest("http://127.0.0.1/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

function sessionCookieFrom(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith("session="));
  expect(cookie).toBeTruthy();
  return cookie!.split(";")[0].split("=")[1];
}

const mergeInput = (canonicalUid: string, duplicateUid: string) => ({
  canonicalUid,
  duplicateUid,
  actorId: "admin-1",
  reason: "test merge",
  roleMergePolicy: "union" as const,
});

async function latestEventId(): Promise<string> {
  const snap = await db.collection(MERGE_EVENTS_COLLECTION).get();
  expect(snap.size).toBe(1);
  return snap.docs[0].id;
}

beforeEach(clearState);
afterAll(clearState);

describe("real Auth emulator convergence", () => {
  it("merge reconciles a real Auth identity end-to-end: disabled/revoked then deleted", async () => {
    await seedUser("canon");
    await seedUser("dup");
    await createAuthUser("canon", "canon@example.test");
    await createAuthUser("dup", "dup@example.test");

    const result = await mergeUserAccounts(mergeInput("canon", "dup"));

    expect(result.duplicateAuthDeleted).toBe(true);
    expect(result.authReconciliation).toBe("reconciled");
    expect(await authUserState("dup")).toEqual({
      exists: false,
      disabled: false,
    });
    // Survivor untouched.
    expect(await authUserState("canon")).toEqual({
      exists: true,
      disabled: false,
    });
    const event = (
      await db
        .collection(MERGE_EVENTS_COLLECTION)
        .doc(await latestEventId())
        .get()
    ).data()!;
    expect(event.authReconciliation.state).toBe("reconciled");
    expect(event.duplicateAuthDeleted).toBe(true);
    const dupDoc = await db.collection(USERS).doc("dup").get();
    expect(dupDoc.data()?.mergedIntoUserId).toBe("canon");
  });

  it("a failed immediate cleanup leaves durable pending state; the sweep then deletes", async () => {
    await seedUser("canon");
    await seedUser("dup");
    await createAuthUser("canon", "canon@example.test");
    await createAuthUser("dup", "dup@example.test");

    // Immediate reconciliation runs through an adapter whose deleteUser
    // fails ONCE (a transient Auth outage), then delegates to the real SDK.
    const realOps = adminMergeAuthOps();
    let deleteCalls = 0;
    const flakyOps: MergeAuthOps = {
      ...realOps,
      deleteUser: async (uid) => {
        deleteCalls += 1;
        if (deleteCalls === 1) {
          throw Object.assign(new Error("auth down"), {
            code: "auth/internal-error",
          });
        }
        return realOps.deleteUser(uid);
      },
    };

    const result = await mergeUserAccounts(mergeInput("canon", "dup"), {
      auth: flakyOps,
    });

    // Firestore merge committed; Auth deletion failed; the identity is left
    // DISABLED (not active) and the work is durably pending.
    expect(result.duplicateAuthDeleted).toBe(false);
    expect(result.authReconciliation).toBe("pending");
    expect(result.duplicateAuthDisabled).toBe(true);
    expect(await authUserState("dup")).toEqual({
      exists: true,
      disabled: true,
    });

    // The scheduled sweep with a healthy Auth reconciles it.
    const sweep = await processMergeAuthReconciliation({
      now: Date.now() + 10 * 60_000, // beyond the ~1m first backoff
      rng: ZERO_JITTER,
    });
    expect(sweep.reconciled).toBe(1);
    expect(await authUserState("dup")).toEqual({
      exists: false,
      disabled: false,
    });
  });

  it("crash after Auth delete but before the outcome write converges on user-not-found", async () => {
    await seedUser("canon");
    await seedUser("dup");
    await createAuthUser("canon", "canon@example.test");
    await createAuthUser("dup", "dup@example.test");

    // Merge with an adapter that makes getUser fail → immediate attempt
    // stays pending; then simulate "the process died after deleting but
    // before recording" by deleting the Auth user directly.
    const real = await import("@/lib/domain/mergeReconciliation");
    const realOps = real.adminMergeAuthOps();
    const blindOps: MergeAuthOps = {
      ...realOps,
      getUser: () =>
        Promise.reject(
          Object.assign(new Error("unreachable"), {
            code: "app/network-error",
          }),
        ),
    };
    const result = await mergeUserAccounts(mergeInput("canon", "dup"), {
      auth: blindOps,
    });
    expect(result.authReconciliation).toBe("pending");

    await auth.deleteUser("dup"); // the "lost" successful delete

    const sweep = await processMergeAuthReconciliation({
      now: Date.now() + 10 * 60_000,
      rng: ZERO_JITTER,
    });
    expect(sweep.reconciled).toBe(1);
    const event = (
      await db
        .collection(MERGE_EVENTS_COLLECTION)
        .doc(await latestEventId())
        .get()
    ).data()!;
    expect(event.duplicateAuthDeleted).toBe(true);
    expect(event.authReconciliation.state).toBe("reconciled");
  });
});

describe("merged-away identity at the session boundary", () => {
  it("cannot mint a new session while reconciliation is still pending", async () => {
    await seedUser("canon");
    await seedUser("dup");
    await createAuthUser("canon", "canon@example.test");
    await createAuthUser("dup", "dup@example.test");

    // Prove the duplicate could sign in BEFORE the merge.
    const preToken = await signInIdToken("dup@example.test", "password-1");
    const preResponse = await POST(sessionRequest(preToken));
    expect(preResponse.status).toBe(200);

    // Merge with Auth reconciliation forced to fail — the Auth identity
    // remains ENABLED (disable also fails) but the marker is committed.
    const deadOps: MergeAuthOps = {
      getUser: () =>
        Promise.reject(
          Object.assign(new Error("down"), { code: "app/network-error" }),
        ),
      disableUser: () =>
        Promise.reject(
          Object.assign(new Error("down"), { code: "app/network-error" }),
        ),
      revokeRefreshTokens: () =>
        Promise.reject(
          Object.assign(new Error("down"), { code: "app/network-error" }),
        ),
      deleteUser: () =>
        Promise.reject(
          Object.assign(new Error("down"), { code: "app/network-error" }),
        ),
    };
    const result = await mergeUserAccounts(mergeInput("canon", "dup"), {
      auth: deadOps,
    });
    expect(result.authReconciliation).toBe("pending");
    // The Auth identity genuinely still exists and is still enabled — the
    // ONLY thing protecting the app right now is the durable marker.
    expect(await authUserState("dup")).toEqual({
      exists: true,
      disabled: false,
    });

    // The merged-away user can still obtain a fresh ID token from Firebase
    // (their credential is alive), but exchanging it for an app session is
    // refused — no session cookie is minted.
    const postToken = await signInIdToken("dup@example.test", "password-1");
    const postResponse = await POST(sessionRequest(postToken));
    expect(postResponse.status).toBe(403);
    expect(
      postResponse.headers.getSetCookie().some((c) => c.startsWith("session=")),
    ).toBe(false);

    // The survivor's session creation is unaffected.
    const canonToken = await signInIdToken("canon@example.test", "password-1");
    const canonResponse = await POST(sessionRequest(canonToken));
    expect(canonResponse.status).toBe(200);
  });

  it("an existing session cookie for the merged-away identity is rejected even while Auth is untouched", async () => {
    await seedUser("canon");
    await seedUser("dup");
    await createAuthUser("canon", "canon@example.test");
    await createAuthUser("dup", "dup@example.test");

    // Establish a REAL session for the duplicate before the merge.
    const idToken = await signInIdToken("dup@example.test", "password-1");
    const sessionResponse = await POST(sessionRequest(idToken));
    expect(sessionResponse.status).toBe(200);
    cookieJar.session = sessionCookieFrom(sessionResponse);
    expect((await getSessionUser())?.uid).toBe("dup");

    // Merge; every Auth operation fails, so the Auth identity is provably
    // untouched — the previously-issued cookie is still cryptographically
    // valid and would verify. Only the committed marker can revoke access.
    const down = () =>
      Promise.reject(
        Object.assign(new Error("down"), { code: "app/network-error" }),
      );
    const deadOps: MergeAuthOps = {
      getUser: down,
      disableUser: down,
      revokeRefreshTokens: down,
      deleteUser: down,
    };
    await mergeUserAccounts(mergeInput("canon", "dup"), { auth: deadOps });
    expect(await authUserState("dup")).toEqual({
      exists: true,
      disabled: false, // still fully enabled at the Auth layer
    });

    // The previously valid cookie now resolves to no session — the
    // application-level merged-away marker rejects it.
    expect(await getSessionUser()).toBeNull();
  });
});

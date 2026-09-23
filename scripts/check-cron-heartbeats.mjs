#!/usr/bin/env node
/**
 * Read-only scheduled-operation heartbeat check (issue #62).
 *
 * Prints the recorded last-attempt/last-success state of every registered
 * cron (`cronHeartbeats` collection) and flags staleness — the signal that a
 * scheduled job is failing silently or was never invoked. It NEVER writes.
 *
 * Usage:
 *   Emulator:
 *     firebase emulators:exec --only firestore \
 *       "node scripts/check-cron-heartbeats.mjs"
 *
 *   Cloud production (explicit --production + unambiguous project):
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *       node scripts/check-cron-heartbeats.mjs --production --project=<id> \
 *       [--database=<db>]
 *     # or: --service-account-file=/path/to/key.json
 *
 * Target resolution is shared with the production integrity diagnostic —
 * cloud targets require --production, a stale FIRESTORE_EMULATOR_HOST mixed
 * with cloud config is rejected, and credentials never come from inline argv.
 *
 * Exit codes: 0 all fresh · 1 at least one stale/unrecorded cron ·
 *   2 config/target/auth failure.
 */

import { readFileSync } from "node:fs";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { resolveIntegrityTarget } from "./lib/integrity-target.mjs";

// Keep in sync with CRON_EXPECTATIONS in src/lib/monitoring/cronHeartbeat.ts.
const CRON_EXPECTATIONS = [
  {
    cron: "continuity-report",
    label: "Nightly continuity report",
    staleAfterMs: 27 * 60 * 60 * 1000,
  },
  {
    cron: "notifications",
    label: "Notification outbox worker",
    staleAfterMs: 60 * 60 * 1000,
  },
  {
    cron: "merge-auth-reconciliation",
    label: "Merge Auth reconciliation sweep",
    staleAfterMs: 3 * 60 * 60 * 1000,
  },
];

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  console.log(
    "Read-only cron heartbeat check (issue #62). See the header of\n" +
      "scripts/check-cron-heartbeats.mjs and docs/OPERATIONS.md for usage.",
  );
  process.exit(0);
}

function fail(message) {
  console.error(message + "\nSee docs/OPERATIONS.md.");
  process.exit(2);
}

const target = resolveIntegrityTarget(process.env, argv);
if ("error" in target) fail(target.error);

let resolvedProject = target.projectId ?? undefined;
let credentialSource;

if (getApps().length === 0) {
  if (target.mode === "emulator") {
    resolvedProject =
      resolvedProject ??
      process.env.GCLOUD_PROJECT ??
      process.env.FIREBASE_ADMIN_PROJECT_ID ??
      "demo-heartbeat-check";
    credentialSource = `emulator (${target.emulatorHost})`;
    initializeApp({ projectId: resolvedProject });
  } else if (target.mode === "service-account-file") {
    let key;
    try {
      key = JSON.parse(readFileSync(target.serviceAccountFile, "utf8"));
    } catch (err) {
      fail(
        `Could not read service-account file ${target.serviceAccountFile}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    resolvedProject = resolvedProject ?? key.project_id;
    if (!resolvedProject) {
      fail(
        "Could not determine the project id from --project or the " +
          "service-account file. Pass --project=<id>.",
      );
    }
    credentialSource = `service-account file (${target.serviceAccountFile})`;
    initializeApp({ credential: cert(key), projectId: resolvedProject });
  } else {
    credentialSource = `application default credentials (${process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "gcloud ADC"})`;
    initializeApp({ projectId: resolvedProject });
  }
}

const db = target.databaseId
  ? getFirestore(getApps()[0], target.databaseId)
  : getFirestore();

console.log(
  `Cron heartbeat check — target=${target.mode} ` +
    `project=${resolvedProject ?? "(unspecified)"} ` +
    `database=${target.databaseId ?? "(default)"} ` +
    `credentials=${credentialSource}`,
);

const now = new Date();
let anyStale = false;

for (const { cron, label, staleAfterMs } of CRON_EXPECTATIONS) {
  let snap;
  try {
    snap = await db.collection("cronHeartbeats").doc(cron).get();
  } catch (err) {
    fail(
      `Failed to read cronHeartbeats/${cron}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const doc = snap.exists ? snap.data() : null;
  const lastSuccess = doc?.lastSuccessAt?.toDate?.() ?? null;
  const lastAttempt = doc?.lastAttemptAt?.toDate?.() ?? null;
  const ageMs = lastSuccess ? now.getTime() - lastSuccess.getTime() : null;
  const stale = !lastSuccess || ageMs > staleAfterMs;
  if (stale) anyStale = true;

  console.log(
    `${stale ? "STALE " : "fresh "} ${label} (${cron})\n` +
      `       lastSuccess=${lastSuccess?.toISOString() ?? "never"} ` +
      `lastAttempt=${lastAttempt?.toISOString() ?? "never"} ` +
      `lastStatus=${doc?.lastStatus ?? "unknown"} ` +
      `consecutiveFailures=${doc?.consecutiveFailures ?? 0}` +
      (ageMs !== null ? ` age=${Math.round(ageMs / 60000)}min` : ""),
  );
}

if (anyStale) {
  console.error(
    "\nAt least one scheduled job is stale — see docs/OPERATIONS.md " +
      '"Production monitoring and alerting" for response steps.',
  );
  process.exit(1);
}
console.log("\nAll registered crons are within their freshness windows.");
process.exit(0);

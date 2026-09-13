#!/usr/bin/env node
/**
 * Read-only PRODUCTION DATA INTEGRITY DIAGNOSTIC (issue #52).
 *
 * Answers "is the live operational Firestore data internally consistent?" for an
 * authorized maintainer, WITHOUT mutating anything. It reuses the same pure,
 * read-only invariant checks as the disaster-recovery validator
 * (`scripts/lib/recovery-checks.mjs` → `runIntegrityChecks`) and adds the
 * production-safety controls #52 requires: an explicit, unambiguous target; a
 * deliberate `--production` acknowledgement for cloud scans; bounded/paginated
 * reads by default; and an exit code that never reports a truncated run as a
 * clean bill of health.
 *
 * This tool NEVER writes: no update/set/delete, no batch, no transaction, no
 * reconciliation. Remediation uses the documented targeted tools (see
 * docs/OPERATIONS.md / docs/INCIDENT_RECOVERY.md); repair is never automatic.
 *
 * Usage:
 *   Emulator (safe, local — e.g. against seeded/restored data in an emulator):
 *     firebase emulators:exec --only firestore \
 *       "node scripts/production-integrity.mjs"
 *
 *   Cloud production (requires explicit --production and an explicit project):
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *       node scripts/production-integrity.mjs --production --project=<id> \
 *       [--database=<db>]
 *     # or: --service-account-file=/path/to/key.json (project may come from the key)
 *
 * Flags:
 *   --production                 acknowledge scanning a live cloud target (required for cloud)
 *   --project=<id>               explicit GCP/Firebase project (required for ADC cloud mode)
 *   --database=<db>              Firestore database id (default: (default))
 *   --service-account-file=<p>   path to a service-account key FILE (never inline JSON)
 *   --full-scan                  scan ALL waterRequests (incl. terminal history), not just active
 *   --page-size=<n>              page size for reads (default 300)
 *   --max-records=<n>            per-collection safety cap (default 50000)
 *   --json                       emit a single JSON document to stdout
 *   --help                       print this help
 *
 * Exit codes: 0 clean & complete-for-scope · 1 critical/warning findings ·
 *   2 config/target/auth failure · 3 no findings but scan truncated by a limit.
 */

import { readFileSync } from "node:fs";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { runIntegrityChecks } from "./lib/recovery-checks.mjs";
import { resolveIntegrityTarget } from "./lib/integrity-target.mjs";
import { argValue } from "./lib/recovery-target.mjs";
import {
  assembleDataset,
  computeExitCode,
  makeFirestoreReader,
} from "./lib/integrity-scan.mjs";

const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");

if (argv.includes("--help")) {
  console.log(
    "Read-only production data integrity diagnostic (issue #52). See the header\n" +
      "of scripts/production-integrity.mjs and docs/OPERATIONS.md for full usage.",
  );
  process.exit(0);
}

function fail(message) {
  console.error(message + "\nSee docs/OPERATIONS.md.");
  process.exit(2);
}

function parsePositiveInt(flag) {
  const raw = argValue(argv, flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    fail(`Invalid ${flag}=${raw}: expected a positive integer.`);
  }
  return n;
}

const target = resolveIntegrityTarget(process.env, argv);
if ("error" in target) fail(target.error);

// ---------------------------------------------------------------------------
// Initialize the Admin SDK for the resolved target and determine the project.
// ---------------------------------------------------------------------------

let resolvedProject = target.projectId ?? undefined;
let credentialSource;

if (getApps().length === 0) {
  if (target.mode === "emulator") {
    resolvedProject =
      resolvedProject ??
      process.env.GCLOUD_PROJECT ??
      process.env.FIREBASE_ADMIN_PROJECT_ID ??
      "demo-integrity-diagnostic";
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
        "Could not determine the project id from --project or the service-account " +
          "file (no project_id field). Pass --project=<id>.",
      );
    }
    credentialSource = `service-account file (${target.serviceAccountFile})`;
    initializeApp({ credential: cert(key), projectId: resolvedProject });
  } else {
    // ADC — the resolver guarantees an explicit project for this mode.
    credentialSource = `application default credentials (${process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "gcloud ADC"})`;
    initializeApp({ projectId: resolvedProject });
  }
}

const db = target.databaseId
  ? getFirestore(getApps()[0], target.databaseId)
  : getFirestore();

const fullScan = argv.includes("--full-scan");
const pageSize = parsePositiveInt("--page-size");
const maxRecords = parsePositiveInt("--max-records");

// ---------------------------------------------------------------------------
// Assemble the bounded dataset (READ-ONLY) and run the pure invariant checks.
// ---------------------------------------------------------------------------

const { dataset, scan } = await assembleDataset(makeFirestoreReader(db), {
  fullScan,
  pageSize,
  maxRecords,
});
const { findings, summary } = runIntegrityChecks(dataset);
const exitCode = computeExitCode(summary, scan);

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        target: {
          mode: target.mode,
          project: resolvedProject ?? null,
          database: target.databaseId ?? "(default)",
          production: Boolean(target.production),
        },
        scan,
        summary,
        findings,
        exitCode,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Human-readable report (opaque IDs only — never names/emails/phones/notes).
// ---------------------------------------------------------------------------

console.log("Production data integrity diagnostic (read-only)\n");
console.log(`  target:      ${target.mode}`);
console.log(`  project:     ${resolvedProject ?? "(unspecified)"}`);
console.log(`  database:    ${target.databaseId ?? "(default)"}`);
console.log(`  credentials: ${credentialSource ?? "already-initialized app"}`);
console.log(`  run mode:    ${scan.mode}`);
console.log(`  scan status: ${scan.scanStatus}\n`);

console.log("Scanned:");
console.log(`  driverRegistry:  ${scan.counts.drivers}`);
console.log(`  users:           ${scan.counts.users}`);
console.log(`  dispatchBatches: ${scan.counts.batches}`);
console.log(
  `  waterRequests:   ${scan.counts.requestsScanned}` +
    (scan.counts.requestsResolvedByReference
      ? ` (+${scan.counts.requestsResolvedByReference} resolved by reference)`
      : ""),
);
if (scan.mode === "operational") {
  console.log(
    "  note: operational scope — terminal request history (confirmed/cancelled) " +
      "was not scanned. Use --full-scan to validate all history.",
  );
}
if (scan.truncated) {
  console.log(
    `  WARNING: scan TRUNCATED at a configured limit ` +
      `(${scan.truncatedCollections.join(", ")}); results are PARTIAL and cannot ` +
      `certify a clean bill of health.`,
  );
}
console.log("");

if (findings.length === 0) {
  if (scan.truncated) {
    console.log(
      "No integrity findings in the records scanned — but the scan was truncated, " +
        "so this is NOT a complete clean result (exit 3).",
    );
  } else if (scan.mode === "operational") {
    console.log(
      "No integrity findings in the operational data. ✓ " +
        "(Terminal request history not scanned — run --full-scan for a complete check.)",
    );
  } else {
    console.log("No integrity findings. ✓ (Complete scan.)");
  }
  process.exit(exitCode);
}

console.log(
  `Found ${findings.length} finding(s) — ` +
    `critical:${summary.bySeverity.critical ?? 0} ` +
    `warning:${summary.bySeverity.warning ?? 0} ` +
    `info:${summary.bySeverity.info ?? 0}\n`,
);
for (const severity of ["critical", "warning", "info"]) {
  const group = findings.filter((f) => f.severity === severity);
  if (group.length === 0) continue;
  console.log(`${severity.toUpperCase()} (${group.length}):`);
  for (const f of group) {
    const related =
      f.relatedIds && f.relatedIds.length
        ? ` related=[${f.relatedIds.join(", ")}]`
        : "";
    console.log(`  [${f.code}] ${f.id}${related} — ${f.detail}`);
  }
  console.log("");
}

console.log(
  "This tool does not mutate data. Investigate findings using the guidance in " +
    "docs/OPERATIONS.md; use the documented targeted reconciliation tools only " +
    "when appropriate. Repair is never automatic.",
);
process.exit(exitCode);

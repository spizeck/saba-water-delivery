#!/usr/bin/env node
/**
 * NON-DESTRUCTIVE PRODUCTION SMOKE RUNNER (issue #84).
 *
 * Answers "did this deployment come up correctly?" for an operator, using ONLY
 * read-only HTTP GET probes: health, readiness, the home and login pages,
 * security headers, and static PWA assets. It is structurally incapable of
 * mutating production: the probe layer (scripts/lib/production-smoke.mjs)
 * issues GET only — there is no POST/PUT/PATCH/DELETE path, no credentials,
 * no Firebase SDK, and no access to cron or mutation endpoints.
 *
 * This is an OPERATOR tool, not a public endpoint. It never runs from CI and
 * is never invoked by the app itself.
 *
 * Usage:
 *   # Production (requires the explicit acknowledgement):
 *   npm run smoke:production -- --url https://saba-water-delivery.vercel.app --production
 *
 *   # Local verification of the runner itself (no --production needed —
 *   # loopback targets only):
 *   npm run smoke:production -- --url http://localhost:3100
 *
 * Flags:
 *   --url=<origin>     REQUIRED. The explicit deployment origin to probe.
 *                      Never defaulted from env, repo config, or Vercel.
 *   --production       REQUIRED for any non-local target. Deliberate
 *                      acknowledgement that the target is a live deployment.
 *   --timeout-ms=<n>   Per-request timeout (default 10000).
 *   --json             Emit a single sanitized JSON document to stdout
 *                      (check names, pass/fail, status, duration, failure
 *                      category — never bodies, headers, or cookies).
 *   --help             Print this help.
 *
 * Exit codes:
 *   0  all smoke checks passed
 *   1  one or more checks failed
 *   2  usage / target-validation error (nothing was probed)
 */

import {
  resolveSmokeTarget,
  runSmokeChecks,
  SMOKE_DEFAULT_TIMEOUT_MS,
} from "./lib/production-smoke.mjs";
import { argValue } from "./lib/recovery-target.mjs";

const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");

if (argv.includes("--help")) {
  console.log(
    "Non-destructive production smoke runner (issue #84).\n" +
      "Usage: npm run smoke:production -- --url <origin> [--production] " +
      "[--timeout-ms <n>] [--json]\n" +
      "See docs/ACCEPTANCE_TESTING.md for the full contract.",
  );
  process.exit(0);
}

function fail(message) {
  console.error(message + "\nSee docs/ACCEPTANCE_TESTING.md.");
  process.exit(2);
}

function parseTimeoutMs() {
  const raw = argValue(argv, "--timeout-ms");
  if (raw === undefined) return SMOKE_DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 100 || n > 120_000) {
    fail(`Invalid --timeout-ms=${raw}: expected an integer 100–120000.`);
  }
  return n;
}

const target = resolveSmokeTarget({
  url: argValue(argv, "--url"),
  production: argv.includes("--production"),
});
if ("error" in target) fail(target.error);

const timeoutMs = parseTimeoutMs();

if (!jsonMode) {
  console.log(
    `Production smoke: ${target.origin}` +
      ` (${target.production ? "PRODUCTION target" : "local target"})`,
  );
}

const result = await runSmokeChecks({
  origin: target.origin,
  production: target.production,
  fetchImpl: fetch,
  timeoutMs,
});

if (jsonMode) {
  // Sanitized only: names, statuses, durations, failure categories. Never
  // bodies, response headers, cookies, or target internals beyond the origin.
  console.log(
    JSON.stringify(
      {
        target: target.origin,
        production: target.production,
        ok: result.ok,
        durationMs: result.durationMs,
        checks: result.checks,
      },
      null,
      2,
    ),
  );
} else {
  for (const check of result.checks) {
    const status = check.status !== undefined ? ` http=${check.status}` : "";
    const detail = check.ok ? "" : ` [${check.failure ?? "failed"}]`;
    console.log(
      `${check.ok ? "PASS" : "FAIL"}  ${check.name}${status}${detail}` +
        ` (${check.durationMs}ms)`,
    );
  }
  console.log(
    `${result.ok ? "SMOKE PASSED" : "SMOKE FAILED"} — ` +
      `${result.checks.filter((c) => c.ok).length}/${result.checks.length} ` +
      `checks passed in ${result.durationMs}ms.`,
  );
}

process.exit(result.ok ? 0 : 1);

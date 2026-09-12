/**
 * Operational health/readiness surface (issue #33).
 *
 * Liveness lives entirely in the `/api/health` route (a constant response with
 * no dependencies). Readiness — whether the app can perform its core
 * Firestore-backed service — is evaluated here. See TECHNICAL.md "Health and
 * readiness endpoints".
 */

export {
  evaluateReadiness,
  withTimeout,
  type CheckStatus,
  type ReadinessStatus,
  type ReadinessResult,
  type EvaluateReadinessOptions,
} from "./readiness";

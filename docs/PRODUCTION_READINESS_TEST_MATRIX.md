# Production Readiness Test Matrix

This document is the canonical record of **which production behaviors are
verified, at what layer, and what remains unproven**. It exists so Public
Entity Saba can answer: _"which important production behaviors are
independently verified, and what remains to prove the rest?"_

- How tests run, which commands to use, and how environments are wired:
  [docs/TESTING.md](TESTING.md)
- Government staging acceptance and production smoke checks:
  [docs/ACCEPTANCE_TESTING.md](ACCEPTANCE_TESTING.md)

## Maintenance rule

Any change that adds a supported workflow, integration, or production
boundary — or changes how an existing one is verified — **must update this
matrix in the same PR**. The matrix is maintained by humans; keep rows
terse, honest, and pointed at real test locations.

## How to read the matrix

### Criticality

| Level    | Meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| Critical | Failure harms residents, corrupts state, leaks PII, or bypasses authorization.          |
| High     | Failure blocks the core delivery workflow or silently loses an operation.                |
| Normal   | Failure degrades experience or observability; a workaround exists.                       |

### Coverage status

| Status            | Meaning                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| verified          | Automated coverage exists in CI at the stated layer and exercises the real behavior. |
| partial           | Some layer is automated but a meaningful behavior or boundary is not proven.         |
| staging-required  | Cannot be fully proven locally; needs the government staging/acceptance environment. |
| prod-smoke        | Verified post-deployment by the non-destructive production smoke procedure only.     |
| manual            | Intentionally verified by documented manual acceptance, not automation.              |
| missing           | No meaningful coverage exists.                                                       |
| disabled / future | Feature exists in code but is not production-enabled.                                |

"Verified" is claimed only where the test exercises the real seam: a mocked
Resend adapter proves the adapter contract, **not** real provider delivery;
the Firebase Auth emulator proves auth flows, **not** Google production
configuration. Rows are deliberately conservative — when in doubt they are
marked `partial`, never `verified`.

### Verification layers

`unit` (pure Vitest) → `emulator` (Firestore Emulator via Admin SDK) →
`rules` (Firestore/Storage Security Rules emulator) → `action` (server
action / route integration) → `e2e` (Playwright against emulators) →
`staging` (government acceptance env) → `smoke` (non-destructive
production smoke). The cheapest reliable layer is always preferred; a
workflow does not need a Playwright test for every edge case.

---

## 1. Authentication / authorization

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Email/password sign-in → httpOnly session cookie | Critical | e2e | verified | `e2e/tests/auth.spec.ts` — real Auth emulator login → `POST /api/auth/session` → portal | — |
| Google sign-in | Critical | e2e + staging | partial | Enabled control rendered in `auth.spec.ts` context; popup/provider flow is emulator-only | Real OAuth acceptance → **#83** |
| Session creation boundary (`/api/auth/session`) | Critical | action | verified | `src/app/api/auth/session/__tests__/route.test.ts` — 503 unconfigured, 400 bad body/token/portal, 401 verify failure, cookie attributes, portal selection, driver gating 403, DELETE clears cookies | Real Google/Auth production tokens → staging |
| Session cookie re-verification (`getSessionUser`/`requireRole`) | Critical | unit | verified | `src/lib/auth/__tests__/session.test.ts` — missing/expired/invalid cookie → null, revocation check on, no profile → null, role redirect + security event | — |
| First-login profile provisioning (`ensureUserProfile`) | High | emulator | verified | `src/lib/domain/__tests__/userProvisioning.emulator.test.ts` — resident-only default, never resets roles, concurrent first-logins can't clobber | — |
| Session expiry / invalid cookie → signed out | Critical | unit + e2e | verified | `session.test.ts` (verify failure → null); `route-protection.spec.ts` (unauth redirect) | — |
| Logout | Normal | e2e | verified | `auth.spec.ts` — cookie cleared, back-navigation re-blocks | — |
| Role authorization (`requireRole` on every portal/action) | Critical | unit + action + e2e | verified | `roles.test.ts`, `session.test.ts`; server-action suites (`recordCustomerDispute.test.ts` pattern); `auth.spec.ts` + `route-protection.spec.ts` | — |
| Multi-role users + role switching | High | unit + e2e | verified | `roles.test.ts` union semantics; session-route test picks requested/remembered portal; `RoleSwitcher` in `PortalHeader` | — |
| Driver Registry gating of driver portal | Critical | action + e2e | verified | Session-route test (role-but-no-linked-entry → 403); `auth.spec.ts` driver login | — |
| Last-admin invariant (concurrency-safe, #70) | Critical | emulator | verified | `adminRoleConcurrency.emulator.test.ts`, `adminInvariantCrossMutation.emulator.test.ts`, `phantomAdmin.emulator.test.ts` | — |
| Facebook login disabled state | Normal | e2e | verified | `auth.spec.ts` — button rendered disabled + "Coming Soon" | Enablement is future work |
| Direct client Firestore writes denied | Critical | rules | verified | `firestore.rules.test.ts` — all portal roles + signed-out | — |

## 2. Resident

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Profile setup + canonical village validation | High | e2e + emulator + unit | verified | `resident-profile.spec.ts`; `userProvisioning.emulator.test.ts` (update refresh + `INVALID_VILLAGE`); `villages.test.ts` | — |
| Delivery-profile confirmation + reminders | Normal | emulator + unit | verified | `userProvisioning.emulator.test.ts` (`confirmDeliveryProfile` completeness guard); `deliveryProfileReminder.test.ts` | — |
| Request creation — one load | Critical | e2e + emulator | verified | `resident-request.spec.ts`; `createWaterRequest.emulator.test.ts` | — |
| Request creation — two loads | Critical | e2e + unit | verified | `resident-request.spec.ts`; `quantity.test.ts` | — |
| One-active-request rule (`DUPLICATE_ACTIVE_REQUEST`) | Critical | emulator | verified | `createWaterRequest.emulator.test.ts` — active statuses, cancel-then-recreate, concurrent double-create, unregistered bypass, dispatcher-on-behalf | — |
| Water situation / attestation capture | High | unit + e2e | verified | `waterRequests.test.ts` (`buildWaterSituationSnapshot`); `resident-request.spec.ts` submits attestation | — |
| Preferred driver on request | High | unit + emulator | verified | `preferredDriverPolicy.test.ts` (hold window, exclusivity boundary, midnight rollover); hold expiry in `waterRequestExpiry.test.ts` | — |
| Preferred-driver hold lifecycle | High | unit + emulator | verified | Same + `residentCancellation.emulator.test.ts` (cancel inside hold) | — |
| Active request display | High | e2e | verified | `resident-request.spec.ts`, `resident-cancel.spec.ts` | — |
| History | Normal | e2e | verified | `resident-request.spec.ts` active/history split | — |
| Delivery confirmation (registered) | Critical | e2e + emulator | verified | `resident-confirmation.spec.ts`; confirm/dispute race cases in `staffRecordedDispute.emulator.test.ts` | — |
| Dispute (registered resident) | Critical | e2e | verified | `resident-confirmation.spec.ts` (disputes delivered request) | — |
| Lazy auto-confirmation on expiry | High | unit + emulator | verified | `deliveryConfirmation.test.ts` (window math); timeout sweep covered in domain/emulator tests and the e2e confirmation path | — |
| Self-cancellation before dispatch (#23) | Critical | emulator + e2e | verified | `residentCancellation.emulator.test.ts` (17 tests), `residentCancellation.test.ts`, `resident-cancel.spec.ts` (5 tests) | — |
| Request again after cancellation | High | emulator + e2e | verified | Same — active slot freed, `createWaterRequest` succeeds after | — |

## 3. Driver

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Account eligibility (registry link required) | Critical | action + e2e | verified | Session-route test (403 without linked entry); `driverRegistryLifecycle.test.ts` | — |
| Online/offline status | High | unit + emulator | verified | `dispatch.test.ts` offerability; registry availability in `driverRegistryLifecycle.test.ts` | — |
| Offer selection ordering | Critical | unit + emulator | verified | `dispatch.test.ts` (priority, ties, holds, decline exclusion, pending-offer reuse); `priority.test.ts`; `dispatchBatchSelection.test.ts`; `dispatchOfferSelection.emulator.test.ts` — canonical ordering across the complete queue via paged streams (>100 candidates, escalation past the old window, catch-all for missing ordering fields, scan bound exhaustion event) | — |
| Offer acceptance (`claimWaterRequest`) | Critical | emulator + e2e | verified | `residentCancellation.emulator.test.ts` claim races; `dispatchOfferSelection.emulator.test.ts` two-driver accept race; `driver-workflow.spec.ts` end-to-end | — |
| Decline / cooldown / daily limits | High | unit + emulator | verified | `dispatch.test.ts` decline exclusion + `declineResult.test.ts`; `driverRegistryLifecycle.test.ts`; `dispatchOfferSelection.emulator.test.ts` — declined candidates across page boundaries, all-declined pages do not end the scan | — |
| Same-request reoffer behavior | High | unit | verified | `dispatch.test.ts` pending-offer reuse/drop cases | — |
| One-load / two-load collection + meter recording | Critical | e2e + unit | verified | `driver-workflow.spec.ts` (1-load and 2-load with meter); `loadCollection.test.ts` helpers + historical-snapshot integrity | — |
| Cannot deliver before required collection | Critical | e2e | verified | `driver-workflow.spec.ts` (UI blocks; domain `LOADS_NOT_COLLECTED` guard) | — |
| Marking delivered | Critical | emulator + e2e | verified | `driver-workflow.spec.ts`; delivery↔notification atomicity in `notificationOutbox.emulator.test.ts` | — |
| Driver release (`activeRequestId` lock) | High | emulator + scripts | verified | Release-on-complete paths in cancellation/merge emulator tests; `scripts/lib/__tests__/activeRequestRuleParity.test.ts` | — |
| Delivery Runs participation | High | e2e | verified | `delivery-run.spec.ts` | — |

## 4. Dispatcher

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Manual registered request | High | e2e | verified | `dispatcher-request.spec.ts` (searched existing resident) | — |
| Manual unregistered request | High | emulator + e2e | verified | `createWaterRequest.emulator.test.ts` (customerId-null path); `dispatcher-request.spec.ts` | — |
| Allowed request editing | Normal | unit | verified | `requestNotes.test.ts`, `waterRequestNotesMapping.test.ts` | — |
| Assignment / reassignment | Critical | e2e + emulator | verified | `dispatcher-assignment.spec.ts`; assignment paths in emulator suites | — |
| Priority + override rank | High | unit + e2e | verified | `priority.test.ts`; escalation display in dispatcher specs | — |
| Escalation ordering across the full queue | High | emulator | verified | `dispatchOfferSelection.emulator.test.ts` — rank-0 escalation at position 120 wins over 119 older unranked requests; equal-rank oldest-first; priority bucket still dominates override | — |
| Preferred-driver behavior on dispatch | High | unit | verified | `preferredDriverPolicy.test.ts`, `dispatch.test.ts` | — |
| Delivery Run creation + lifecycle | High | e2e + emulator | verified | `delivery-run.spec.ts`; `closeDeliveryRun` atomicity in `auditEventAtomicity.emulator.test.ts` | — |
| Staff-recorded ordinary delivery | Critical | emulator + e2e | verified | `staffRecordedDispute.emulator.test.ts` confirm paths; dispatcher specs | — |
| Staff-recorded Delivery Run delivery | High | e2e | verified | `delivery-run.spec.ts` | — |
| Confirmation for unregistered customers | Critical | emulator | verified | `staffRecordedDispute.emulator.test.ts` (confirm/dispute races on `customerId: null`) | — |
| Staff-recorded unregistered dispute (#50) | Critical | emulator + action + e2e | verified | `staffRecordedDispute.emulator.test.ts` (30), `recordCustomerDispute.test.ts`, `dispatcher-dispute.spec.ts` (3) | — |
| Dispute resolution (resolve/reopen) | Critical | emulator | verified | `staffRecordedDispute.emulator.test.ts` resolution-reuse suites | — |
| Batch dispatch PDF download route | Normal | action | verified | `src/app/api/dispatcher/batches/[batchId]/pdf/__tests__/route.test.ts` — staff gate, 404, audit-on-download, no-store | — |

## 5. Administrator

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| User listing / detail | Normal | — | partial | `getResidentDirectory` exercised via dispatcher flow; admin user-directory UI has no dedicated test | Low — read-only view |
| Role management | Critical | emulator | verified | `adminRoleConcurrency.emulator.test.ts` (concurrent demotion), `adminInvariantCrossMutation.emulator.test.ts` | Admin portal UI has no e2e — domain/rules enforced server-side |
| Self-admin + last-admin protection | Critical | emulator | verified | `adminRoleConcurrency.emulator.test.ts`, `phantomAdmin.emulator.test.ts` | — |
| Driver Registry management + restriction/reactivation | Critical | unit + emulator | verified | `driverRegistryLifecycle.test.ts`; `auditEventAtomicity.emulator.test.ts` (restrict/restore + meter atomicity) | — |
| Active-delivery safeguards | High | unit + emulator | verified | `activeRequestValidation.test.ts`; `activeRequestRuleParity.test.ts` (script parity) | — |
| Account linking (claim unclaimed profiles) | High | unit | verified | `identityMatching.test.ts`, `staffRegistration.test.ts` | — |
| Account merging | Critical | emulator | verified | `mergeAtomicAudit.emulator.test.ts` (atomicity, write-limit ceiling), `phantomAdmin.emulator.test.ts` | — |
| Auth↔profile reconciliation | High | scripts/unit | verified | `scripts/lib/__tests__/integrity-*.test.ts` cover the read-only checks | — |
| Merge Auth reconciliation (#73) | Critical | unit + Firestore emulator + **Auth emulator** | verified | `mergeReconciliationPolicy.test.ts` (pure state machine/backoff/classification); `mergeReconciliation.emulator.test.ts` (claim/lease/crash windows/backoff/terminal/manual retry/survivor safety/starvation-free + work-conserving fair sweep selection/attempt-budget accounting); `mergeAuthReconciliation.auth-emulator.test.ts` (real disable/revoke/delete, `user-not-found` convergence, merged-away session rejection); session + cron route unit tests | Emulator proves the mechanics; controlled acceptance on real Firebase Auth is a **staging** item → **#83** |
| Dispatch configuration | High | emulator | verified | `dispatchSettingsAtomic.emulator.test.ts` (atomic config+audit, serialized updates) | — |
| Atomic audit behavior (#49) | Critical | emulator | verified | `auditEventAtomicity.emulator.test.ts`, `mergeAtomicAudit.emulator.test.ts`, `staffRecordedDispute.emulator.test.ts`, `residentCancellation.emulator.test.ts` | — |
| Production data diagnostics (#52) | Normal | unit | verified | `scripts/lib/__tests__/integrity-checks.test.ts`, `integrity-scan.test.ts`, `integrity-target.test.ts`, `recovery-*.test.ts` — read-only, bounded, `--production` acknowledgement | Live runs are admin-triggered → OPERATIONS |
| Staff-created person registration | High | unit | verified | `staffRegistration.test.ts` | — |

## 6. Viewer

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Read-only open-operations view | High | e2e | verified | `e2e/tests/viewer.spec.ts` — open requests + driver status, read-only banner | — |
| PII projection (no phone/email/directions) | Critical | unit + e2e | verified | `viewerProjection.test.ts`; `viewer.spec.ts` asserts seeded PII absent from payload | — |
| Cannot mutate | Critical | rules + unit + e2e | verified | `firestore.rules.test.ts` denies writes for viewer role; `viewer.spec.ts` (no controls); `session.test.ts` requireRole | — |

## 7. Notifications (transactional)

Only the **delivery-confirmation email is durable** — staged atomically in
the same transaction as the delivery mutation (#53). The continuity-report
and account-setup emails remain **best-effort direct sends** — do not
describe them as durable.

| Capability | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Durable intent atomic with delivery | Critical | emulator | verified | `notificationOutbox.emulator.test.ts` — commits together, both roll back, none for unregistered | — |
| Transient failure → bounded backoff retry | Critical | emulator + unit | verified | `notificationOutbox.emulator.test.ts` retry suites; `outboxPolicy.test.ts` `computeBackoffMs` | — |
| Terminal failure (max attempts) | High | emulator | verified | `notificationOutbox.emulator.test.ts` | — |
| Idempotency (no duplicate sends) | Critical | emulator + unit | verified | `notificationOutbox.emulator.test.ts`; `outboxPolicy.test.ts` deterministic keys | — |
| Provider-accept / local-record-failed ambiguity | Critical | emulator | verified | `notificationOutbox.emulator.test.ts` — retry reuses identical provider idempotency key; provider deduplication protects the ambiguous provider-accept/local-recording crash window | — |
| Worker leasing / concurrent workers | High | emulator | verified | `notificationOutbox.emulator.test.ts` lease + reclaim suites | — |
| Admin manual retry | Normal | emulator | verified | `notificationOutbox.emulator.test.ts` | — |
| Sender composition / recipient selection | High | unit | verified | `deliveryConfirmationSender.test.ts`, `deliveryNotificationTrigger.test.ts`, `deliveryConfirmationEmail*.test.ts` | — |
| Unregistered recipient behavior | High | emulator | verified | `notificationOutbox.emulator.test.ts` — no intent without an authenticated recipient | — |
| Notification cron authorization + aggregate-only response | Critical | action | verified | `src/app/api/cron/notifications/__tests__/route.test.ts` | — |
| Real Resend delivery | High | staging | staging-required | Adapter/content unit-tested with mocked client only | Government Resend account → **#58** + acceptance procedure |
| Continuity report email (best-effort) | Normal | unit + action | partial | `continuityReportEmailContent.test.ts`; cron route test asserts send invoked | Not in outbox — by design; provider acceptance → staging |
| Account setup invitation email (best-effort) | Normal | unit | partial | `accountSetupEmailContent.test.ts` | Same |

## 8. Operational / system boundaries

| Boundary | Crit | Layer(s) | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| Firebase Authentication | Critical | e2e + action | partial | Emulator covers full sign-in/session/portal flow | Production provider config + real Google → staging (#56/#57) |
| Firestore Admin SDK mutations | Critical | emulator | verified | All `*.emulator.test.ts` run real Admin SDK | Production project config → smoke/staging |
| Firestore Security Rules | Critical | rules | verified | `firestore.rules.test.ts` — signed-out + every portal role, locked collections, catch-all | Deployed-rules parity → staging |
| Firebase Storage Rules | Critical | rules | verified | `firestore.rules.test.ts` "Storage deny-all" — deny-all scaffold, every role + anon | Photo rules when built → new matrix rows |
| Resend adapter | High | unit | partial | `src/lib/email/__tests__/*` — content/contract with mocked client | Real delivery → staging + #58 |
| Notification cron auth | Critical | action | verified | `api/cron/notifications/__tests__/route.test.ts` | — |
| Continuity cron auth | Critical | action | verified | `api/cron/continuity-report/__tests__/route.test.ts` | — |
| Continuity snapshot route auth | Critical | action | verified | `api/reports/continuity-snapshot/__tests__/route.test.ts` | — |
| Rate limiting (Firestore-backed, cross-instance) | High | unit + emulator | verified | `rateLimit.test.ts` (window/keying); `firestore.rateLimit.emulator.test.ts` (atomic concurrent increments) | — |
| Structured logging / redaction / request IDs | High | unit | verified | `src/lib/logging/__tests__/*` (redaction incl. PII no-leak, request-context); `apiRoute.test.ts` | Production log drain → OPERATIONS |
| `/api/health` | Normal | action + e2e | verified | `api/health/__tests__/route.test.ts`; `health-security.spec.ts` | Prod availability → smoke |
| `/api/readiness` | High | action + e2e | verified | `api/readiness/__tests__/route.test.ts`, `readiness.test.ts`; `health-security.spec.ts` | Prod availability → smoke |
| Security headers / CSP | High | unit + e2e | verified | `headers.test.ts` (structure, required origins, no-leak); `health-security.spec.ts` | — |
| PDF generation | Normal | unit | verified | `continuityReportPdf.test.ts`, `dispatchBatchPdfFilename.test.ts` | — |
| PDFKit trace verification | Normal | build | verified | `scripts/verify-pdfkit-trace.mjs` runs as `postbuild` — build fails if trace is absent | — |
| Continuity reporting pipeline | Normal | unit + action | verified | `continuityReportData.test.ts`; cron + snapshot route tests | Scheduled delivery → staging |
| Data-integrity diagnostics (#52) | Normal | unit | verified | `scripts/lib/__tests__/integrity-*.test.ts`, `recovery-*.test.ts` | — |
| Deployment configuration validation | High | unit | verified | `deployment.test.ts`, `serverConfig.test.ts`, `validators.test.ts`, `appOrigin.test.ts`; emulator-refusal on deployed Vercel in `firebase/admin.ts` | Real deploy config → Vercel check + **#54** |
| Disabled WhatsApp/Meta intake | — | action + unit | disabled / future | `webhooks/whatsapp/__tests__/route.test.ts` (verify token, signature rejection, idempotent processing); `whatsapp/__tests__/*` parsing/conversation | Not production-enabled — matrix tracks disabled state only |
| Disabled Facebook Auth | — | e2e | disabled / future | `auth.spec.ts` disabled-button assertion | Not production-enabled |

## 9. CI / production safety safeguards

| Safeguard | Crit | Layer | Status | Where | Gap / issue |
|---|---|---|---|---|---|
| E2E cannot target production/Vercel | Critical | unit + config | verified | `e2e/support/__tests__/safety.test.ts` (`assertEmulatorSafety`, loopback-host + `demo-` project checks); `playwright-config.test.ts` (webServer env); `global-setup.ts` invokes the guard | — |
| Emulator env explicit in E2E | Critical | config + unit | verified | `e2e/support/config.ts` (demo- project, local hosts); `playwright-config.test.ts` asserts webServer env | — |
| Synthetic test accounts/data only | High | config | verified | `e2e/support/config.ts` `E2E_ACCOUNTS`; `seed.ts` deterministic seeds | — |
| No production credentials in CI | Critical | CI | verified | `.github/workflows/ci.yml`, `e2e.yml` — emulator-only env; `verify`/`playwright` jobs need no secrets | — |
| External notifications cannot reach real residents | Critical | design + unit | verified | Email paths all route through mocked/emulator seams; no live Resend key exists in CI or test env | Real-provider path only with a real key → staging procedure |
| Emulator refused on deployed Vercel | Critical | code + unit | verified | `assertNotDeployedEmulatorMode` in `firebase/admin.ts` throws on emulator hosts in deployed env | — |
| Production smoke runner (#84) | High | unit | verified | `scripts/lib/__tests__/production-smoke.test.ts` — fail-closed target validation (`--url` + `--production`, loopback/IP/SSRF rejection), GET-only probes, same-origin redirect policy, timeouts, sanitized `--json`, deterministic exit codes; verified live against the pilot | First run against the government domain → post-#59 |

---

## Environment boundaries (summary)

| Environment | What it proves | What it cannot prove |
|---|---|---|
| Local / CI | Every `verified`/`partial` row: domain logic, transactions, Security Rules, auth flows against emulators, mocked provider contracts, script diagnostics | Real Google OAuth, real Resend delivery, deployed-rules parity, production data, scale |
| Government staging (future — needs #56/#57/#58) | Real-provider acceptance: Google sign-in, Resend delivery to designated recipients, deployed rules, Vercel callback/origin config | Production data volume |
| Production smoke | Non-destructive post-deploy liveness: page loads, `/api/health`, `/api/readiness`, auth entry — via `scripts/production-smoke.mjs` (#84, GET-only) | Any operational mutation — explicitly prohibited; provider-level sign-in controls are client-hydrated and stay a staging item |

## Material gaps and their tracking

| Gap | Severity | Tracking |
|---|---|---|
| Government staging environment does not exist (government-owned Firebase project, Vercel, Resend domain) | Blocks all `staging-required` rows | **#83** (blocked on #56, #57, #58) |
| Non-destructive production smoke not yet run against government production (runner built, tested, and verified against the pilot; official domain pending #59) | High | **#84** — government execution follows #56/#57/#59 |
| Real-Firebase-Auth acceptance of merge reconciliation (emulator proven; live disable/revoke/delete + revocation propagation unverified) | High | **#83** (staging) — mechanics verified in CI by #73 |
| Admin portal UI has no e2e coverage (domain + rules verified below the browser layer) | Low | Acceptable — noted; add e2e only if admin UI gains risky client logic |
| Continuity + account-setup emails are best-effort (not in outbox) | Low — deliberate design | Documented here; revisit only if a lost email matters operationally |
| Expired-cookie e2e (would need clock control) | Low — unit layer covers the logic | Noted for completeness |

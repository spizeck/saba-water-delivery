# Architecture Decision Records (ADRs)

This directory records the **significant architectural decisions** already made
in Saba Water Delivery — the reasoning, the alternatives that were weighed, the
consequences, and the operational implications — so a future Public Entity Saba
maintainer or government IT administrator can understand _why_ the system is
built the way it is without reverse-engineering it from the code.

Saba Water Delivery was developed on a volunteer basis for the Public Entity
Saba and is intended to be handed over for government operation (see
[`../../README.md`](../../README.md) "Project Provenance and Handover"). These
ADRs are part of that handover: they are written for a competent developer or IT
administrator who was **not** involved in the original development.

## What an ADR is (and is not)

An ADR captures **one significant architectural decision**: a choice that shapes
how the system is built, secured, or operated and that would be costly or
dangerous to reverse by accident. ADRs are **not** a place for every
implementation detail — the implementation docs remain authoritative for current
mechanics:

- Deep technical mechanics → [`../../TECHNICAL.md`](../../TECHNICAL.md)
- Contributor/agent guidance → [`../../DEVIN.md`](../../DEVIN.md)
- Day-to-day operations → [`../OPERATIONS.md`](../OPERATIONS.md)
- Deployment/config → [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- Outage playbooks → [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)
- Backup/restore runbook → [`../DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md)

An ADR states the decision and its rationale; it links to the implementation
docs and source rather than duplicating them.

## When to create a new ADR

Create an ADR when a change:

- changes persistence / data architecture,
- changes authentication or authorization boundaries,
- changes lifecycle / state-machine semantics (request, dispatch, delivery),
- changes dispatch fairness or public-service policy encoded in software,
- changes external-integration reliability semantics,
- changes deployment or recovery architecture,
- changes a major security boundary, or
- introduces a major infrastructure dependency.

Do **not** create an ADR for: ordinary bug fixes, UI polish, copy changes,
routine dependency updates, or refactors that preserve the architecture.

## Superseding — do not rewrite history

- Accepted ADRs should generally **not** be rewritten to make history look
  cleaner. They record what was decided and why, as of a point in time.
- When a decision genuinely changes, write a **new** ADR that supersedes the old
  one. Set the new ADR's status to `Accepted`, reference the ADR it replaces,
  and set the old ADR's status to `Superseded by NNNN`.
- Do **not** delete a historical ADR just because the decision changed.

## Format

Each ADR uses the fields in [`TEMPLATE.md`](./TEMPLATE.md): Title, Status, Date,
Context, Decision, Alternatives considered, Consequences, Operational
implications, References. Numbering is sequential (`0001-...`, `0002-...`).

**Status** is one of:

- **Accepted** — the decision is in force. (Every ADR in the initial set is
  Accepted; each documents architecture that already exists.)
- **Superseded** — replaced by a later ADR (which it names).
- **Proposed** — under consideration, not yet in force.

**Dates.** The initial ADRs record decisions that were made earlier than the ADR
was written. Each shows an "ADR recorded" date (2026-09-12, when this directory
was created for issue #36) and, where the decision date is clearly recoverable
from Git history, the original decision date. Dates are not fabricated; where an
original date is uncertain the ADR says so.

## Index

| #                                                            | Title                                                              | Status   |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| [0001](./0001-firebase-data-and-auth-platform.md)            | Firebase as the data and authentication platform                   | Accepted |
| [0002](./0002-nextjs-app-router-vercel-deployment.md)        | Next.js App Router + TypeScript on Vercel (webpack build)          | Accepted |
| [0003](./0003-server-authoritative-mutation-model.md)        | Server-authoritative mutation model                                | Accepted |
| [0004](./0004-authentication-and-session-architecture.md)    | Authentication and session architecture                            | Accepted |
| [0005](./0005-multi-role-authorization-and-driver-eligibility.md) | Multi-role authorization and Driver Registry eligibility      | Accepted |
| [0006](./0006-water-request-lifecycle-and-quantity-model.md) | Water request lifecycle and quantity model                         | Accepted |
| [0007](./0007-dispatch-fairness-and-preferred-driver-policy.md) | Dispatch fairness and preferred-driver policy                   | Accepted |
| [0008](./0008-delivery-runs-batch-dispatch-exception.md)     | Delivery Runs as a controlled exception to single-request dispatch | Accepted |
| [0009](./0009-delivery-completion-and-resident-confirmation.md) | Delivery completion and resident confirmation model             | Accepted |
| [0010](./0010-audit-events-vs-application-logs.md)           | Business audit events vs. application logs                         | Accepted |
| [0011](./0011-external-integration-failure-model.md)         | External integration (email/WhatsApp) failure model                | Accepted |
| [0012](./0012-security-and-observability-baseline.md)        | Security and observability baseline                                | Accepted |
| [0013](./0013-testing-and-release-gates.md)                  | Testing strategy and release gates                                 | Accepted |
| [0014](./0014-backup-and-disaster-recovery-strategy.md)      | Backup and disaster-recovery strategy                              | Accepted |
| [0015](./0015-saba-operational-timezone.md)                  | Fixed Saba operational timezone (America/Puerto_Rico)              | Accepted |
| [0016](./0016-centralized-configuration-model.md)            | Centralized, validated configuration boundary                      | Accepted |
| [0017](./0017-notification-outbox-and-retry.md)              | Durable notification outbox and retry                              | Accepted |
| [0018](./0018-account-merge-auth-reconciliation.md)          | Durable account-merge Firebase Auth reconciliation                 | Accepted |
| [0019](./0019-production-error-monitoring-sentry.md)         | Production exception monitoring via Sentry                         | Accepted |
| [0020](./0020-scheduled-operation-heartbeat-monitoring.md)   | Scheduled-operation heartbeat monitoring                           | Accepted |

## Especially dangerous assumptions preserved here

Several ADRs deliberately record decisions a future developer might otherwise
"fix" into a bug. If you are about to change any of the following, read the
linked ADR first:

- The Firebase **Admin SDK bypasses Firestore security rules** — rules are a
  client boundary, not a server authorization boundary ([0003](./0003-server-authoritative-mutation-model.md)).
- **Deny-all client rules are not a production server write freeze** ([0003](./0003-server-authoritative-mutation-model.md)).
- **Delivery Runs intentionally break** the "every claimed request equals the
  driver's `activeRequestId`" assumption ([0008](./0008-delivery-runs-batch-dispatch-exception.md)).
- A **`delivered` request awaiting resident confirmation is not active physical
  driver work** ([0009](./0009-delivery-completion-and-resident-confirmation.md)).
- **Email/WhatsApp failures must not reverse committed delivery state** ([0011](./0011-external-integration-failure-model.md)).
- **Automated E2E must never touch deployed Firebase** ([0013](./0013-testing-and-release-gates.md)).
- **Rate limiting is defense-in-depth and may fail open**; authentication and
  business authorization remain authoritative ([0012](./0012-security-and-observability-baseline.md)).
- **Configuration validation reports state; it must not change failure
  semantics** — the rate limiter still fails open and optional integrations stay
  non-readiness-critical ([0016](./0016-centralized-configuration-model.md)).
- **The notification outbox is at-least-once, NOT exactly-once**, and its intent
  is created inside the delivery transaction — never as a separate post-commit
  write; a notification failure still never rolls back delivery state
  ([0017](./0017-notification-outbox-and-retry.md)).
- **Health and readiness have intentionally different semantics** ([0012](./0012-security-and-observability-baseline.md)).
- **Firestore backup/PITR protection is per database**, and a named recovery
  database does not inherit `(default)`'s protections; the continuity report is
  an outage aid, not a backup ([0014](./0014-backup-and-disaster-recovery-strategy.md)).

# 0017. Durable notification outbox and retry

- **Status:** Accepted
- **Date:** 2026-09-13 (issue #53)

## Context

External notifications are sent AFTER authoritative Firestore state commits, so a
Resend/WhatsApp outage can never roll back valid business state
([0011](./0011-external-integration-failure-model.md)). That ordering is correct,
but the pre-existing delivery-confirmation path sent the email exactly once,
best-effort, immediately after the delivery transaction: a transient provider
failure meant the notification was lost unless a staff member noticed and acted.
The former `deliveryConfirmationEmailClaims/{requestId}` document only guaranteed
"send at most once" — it provided no retry. The delivery-confirmation email is
the first case that warrants durable, automatic retry, and the design should
extend to future durable notifications without coupling core state transitions to
provider availability.

## Decision

Add a small **durable notification outbox** in Firestore with a protected cron
worker.

- **Durable classification (deliberately narrow).** Only **delivery-confirmation
  email** uses the outbox. Account-setup invitations stay best-effort (the admin
  sees the synchronous send result and can re-invite); the continuity report is
  reconstructible operational reporting; WhatsApp is an interactive webhook reply
  (and not production-provisioned), not a Firestore-generated obligation. Not
  every email becomes guaranteed-delivery infrastructure.
- **`notificationOutbox/{type}__{requestId}`** — deterministic id (one document
  per logical notification across retries). Stores only stable references
  (`requestId`, `customerId` — opaque ids) and non-PII state/timing; **never** the
  recipient email, message body, delivery directions, token, or any secret. The
  recipient and content are recomputed from the referenced request/profile at
  send time, so a retry never relies on a stale snapshot and no PII is duplicated.
- **State machine:** `pending` → `processing` (leased) → `sent` (terminal) or
  `failed` (terminal). Only an explicit admin manual retry returns `failed` to
  `pending`.
- **Atomic intent.** For a registered requestor, the intent is created **inside
  the same Firestore transaction** as the delivery transition — never as a
  separate post-commit write, which would merely move the lost-notification crash
  window. An unregistered requestor (`customerId: null`) gets no intent and thus
  no authenticated confirmation link. Sending happens later, never inside that
  transaction, and never blocks it on Resend.
- **Worker leasing.** A bounded cron pass claims due work with a Firestore lease
  transaction (`processing` + `leaseOwner` + `leaseExpiresAt`), sends OUTSIDE any
  transaction, then records the outcome in a second transaction guarded by lease
  ownership. An active lease blocks a concurrent worker; an expired lease (a
  crashed worker) is reclaimable; a `sent` notification is never reclaimed; a
  `failed` one is reclaimed only by manual retry.
- **Bounded retry.** Exponential backoff with jitter (~1m/5m/15m/1h/3h,
  `MAX_ATTEMPTS` total) then terminal `failed`. Failures are classified —
  transient (retry), permanent, `configuration_disabled` (Resend unconfigured →
  terminal, not hammered; manual retry after repair), and `recipient_ineligible`
  (terminal). Only a sanitized failure category/code is stored, never a provider
  body.
- **Idempotency and the honest guarantee.** Every attempt reuses the
  deterministic `delivery-confirmation-{requestId}` provider idempotency key. The
  realistic guarantee is **at-least-once processing with provider-level
  de-duplication**, NOT exactly-once. The crash window between provider
  acceptance and the local `sent` write is covered because the retry reuses the
  same key — but only within Resend's idempotency window. The total retry horizon
  (~4.3h) is kept below that window (~24h) so the coverage holds; if the window
  were ever shorter than the horizon a late retry could duplicate, which is
  documented rather than papered over.
- **Operator visibility.** An admin-only `/admin/notifications` view lists
  terminally-failed notifications (sanitized, opaque ids) with a
  server-authoritative manual retry. `notificationOutbox` is deny-by-default to
  all clients; access is server-only via the Admin SDK.

## Alternatives considered

- **Keep best-effort one-shot send:** rejected — transient outages silently drop
  important confirmations.
- **A queue/PubSub/Cloud Tasks service:** rejected — Firestore + a protected cron
  meets the need on the existing Vercel/Firebase architecture without new
  infrastructure or cost (see DEVIN.md "Do Not Overbuild").
- **Post-commit outbox write (outside the delivery transaction):** rejected — it
  only moves the lost-notification crash window from "send" to "create outbox".
  The intent is created in the authoritative transaction instead.
- **Snapshotting the rendered email / recipient into the outbox:** rejected —
  duplicates PII (recipient, directions) and risks staleness; a stable reference
  plus send-time recompute is sufficient and safer.
- **Claiming exactly-once delivery:** rejected as untrue; the guarantee is stated
  honestly as at-least-once with provider de-duplication.

## Consequences

- Delivery-confirmation email survives transient provider outages and process
  crashes and retries automatically; permanent failures are operator-visible and
  manually retriable; delivery/request state is never rolled back by a
  notification failure.
- The former `deliveryConfirmationEmailClaims` collection is **superseded**;
  historical documents are inert and intentionally not migrated (they live in a
  different collection and cannot suppress a new outbox retry). Failures under the
  old one-shot notifier are not resurrected.
- Two composite indexes back the worker's due/expired-lease queries (see
  `firestore.indexes.json`); the emulator serves them without deployment.
- The worker cron cadence bounds the retry cadence. `vercel.json` schedules it
  every 10 minutes; this depends on the Vercel plan's cron granularity. The
  worker is correct at any cadence (`nextAttemptAt` is a lower bound, processing
  is at-least-once) and can also be invoked manually or by an external scheduler.

## Operational implications

- **Dangerous assumption to preserve:** the outbox reports and retries; it must
  never change the [0011](./0011-external-integration-failure-model.md) rule that
  a notification failure cannot reverse committed delivery state, nor make the
  delivery transaction wait on Resend.
- Missing Resend configuration yields a terminal `configuration_disabled`
  notification (visible to operators), not endless retries; fix configuration
  then manually retry. See [`../OPERATIONS.md`](../OPERATIONS.md) and
  [`../INTEGRATIONS.md`](../INTEGRATIONS.md).

## References

- [`src/lib/notifications/`](../../src/lib/notifications) (outboxPolicy, outbox,
  worker, deliveryConfirmationSender, outboxAdmin),
  [`src/app/api/cron/notifications/route.ts`](../../src/app/api/cron/notifications/route.ts),
  [`src/app/admin/notifications/`](../../src/app/admin/notifications)
- [`../DATA_MODEL.md`](../DATA_MODEL.md), [`../INTEGRATIONS.md`](../INTEGRATIONS.md),
  [`../OPERATIONS.md`](../OPERATIONS.md), TECHNICAL.md "Durable notification outbox"
- [0011](./0011-external-integration-failure-model.md),
  [0012](./0012-security-and-observability-baseline.md)

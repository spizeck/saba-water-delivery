# 0011. External integration (email/WhatsApp) failure model

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (Resend email and WhatsApp ordering added
  2026-08-21; records an existing decision)

## Context

The app integrates two external providers: **Resend** (transactional email — the
nightly/manual continuity report and delivery-confirmation notifications) and the
**Meta WhatsApp** Cloud API (a resident ordering channel). External providers
fail, rate-limit, or lose messages. Those failures must never corrupt or reverse
the authoritative water-delivery state in Firestore.

## Decision

- **Firestore is the authoritative store; the integrations are not.** Core
  state (a created request, a recorded delivery, a confirmation) is **committed
  to Firestore first**, and provider notifications are **best-effort** afterward.
  A failed email/WhatsApp send is logged (sanitized) and surfaced where useful,
  but **never rolls back or blocks** the committed core operation.
- **WhatsApp is a front end to the same system, not a separate one.** Every
  inbound WhatsApp message is recorded in Firestore and creates/updates the same
  `waterRequests` data the website uses — there is no parallel request store.
- **WhatsApp webhook security:** inbound POSTs are verified by an
  `X-Hub-Signature-256` HMAC over the raw body before processing; the
  verification handshake uses a configured verify token. The body, signature, and
  sender are never logged.
- **Idempotency:** WhatsApp message processing claims the provider message id
  (`whatsappProcessedMessages`) so a redelivered webhook is not processed twice;
  the delivery-confirmation email uses an idempotency claim so it is not sent
  twice. Losing these idempotency records risks at most a duplicate action, never
  data corruption.

## Alternatives considered

- **Committing state and notification atomically (fail the operation if email
  fails):** rejected — a Resend/Meta outage would then block deliveries and
  confirmations, which is unacceptable for a water service.
- **Treating WhatsApp as an independent ordering system:** rejected — it would
  fork the request data; instead it writes to the same Firestore records.
- **Skipping webhook signature/idempotency:** rejected — forged or duplicated
  webhooks are a real risk; HMAC + idempotency are the correct controls.

## Consequences

- Delivery/confirmation succeed even when email is down; the report can be
  regenerated/resent later (see [`../INCIDENT_RECOVERY.md`](../INCIDENT_RECOVERY.md)).
- During a Firebase outage, WhatsApp is **not** an independent channel — it
  cannot record or act on a message until Firestore recovers.
- Provider config (keys/tokens) is recovered/rotated via the vendor consoles, not
  from any backup ([0014](./0014-backup-and-disaster-recovery-strategy.md) §Environment).

## Operational implications

- **Dangerous assumption to preserve:** an email/WhatsApp failure must not
  reverse committed delivery state. Keep the commit-then-notify ordering.
- Email is configured via `RESEND_API_KEY` + from/to addresses; WhatsApp via the
  `WHATSAPP_*` variables. Failures appear as sanitized log events, not as data
  changes.

## References

- [`src/app/api/webhooks/whatsapp/route.ts`](../../src/app/api/webhooks/whatsapp/route.ts),
  [`src/lib/whatsapp/`](../../src/lib/whatsapp)
- [`src/lib/email/`](../../src/lib/email) (Resend integration, confirmation email
  idempotency claim)
- TECHNICAL.md "WhatsApp Resident Ordering", "Operational Continuity Snapshot";
  [`../INTEGRATIONS.md`](../INTEGRATIONS.md)

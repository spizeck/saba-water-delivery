# 0018. Durable account-merge Firebase Auth reconciliation

- **Status:** Accepted
- **Date:** 2026-09-15 (issue #73)

## Context

An administrative account merge commits all of its authoritative Firestore
state atomically (ADR 0003, issue #49), but **Firebase Authentication cannot
participate in a Firestore transaction**. Before this decision, the merged-away
("duplicate") Firebase Auth identity was deleted by a single best-effort
`deleteUser()` call after the merge commit. If that call failed — or the
process crashed between the Firestore commit and the Auth call — the duplicate
Auth identity remained fully able to authenticate, and because its `users`
document is intentionally retained for historical linkage, it could still act
with whatever non-`admin` roles it held. The only record of the failure was a
`duplicateAuthDeleted: false` flag plus an `error` string: discoverable, but
with no automatic path back to a safe state.

The failure window that had to be closed:

1. Firestore merge commits (audit record + all relinks durable).
2. Process crashes or the `deleteUser()` call fails.
3. The duplicate Auth identity keeps working indefinitely — until a human
   notices and manually deletes it in the Firebase console.

An additional subtlety: even a prompt `deleteUser()` is not the only
protection needed. Disabling a user prevents *new* token issuance, and
`verifySessionCookie(cookie, true)` rejects disabled/revoked credentials, but
the session-creation route previously verified the ID token *without*
revocation checking, and a belt-and-suspenders application-level rejection is
valuable regardless of Firebase's credential-invalidation timing.

## Decision

The merge's Firestore transaction now also stamps
`users/{duplicateUid}.mergedIntoUserId` and an `authReconciliation` sub-record
(state `pending`) on the `accountMergeEvents` document — making the
reconciliation obligation durable at commit time, in the same atomic write as
the merge itself. Firebase Auth convergence is then an honest **at-least-once,
idempotent** process driven by `src/lib/domain/mergeReconciliation.ts`:

- **Application-level rejection is the primary safety control.** Both
  authentication boundaries — `POST /api/auth/session` (session creation) and
  `getSessionUser()` (session-cookie verification) — load the profile and
  reject any uid whose `mergedIntoUserId` is set, from the moment the merge
  commits, regardless of Auth state. Session creation also verifies the ID
  token *with* revocation checking (`verifyIdToken(token, true)`) and refuses
  disabled Auth users. A merged-away identity therefore cannot access the
  application even if every Auth call below fails.
- **Auth operation order:** `getUser` → `updateUser({disabled: true})` (skip
  if already disabled) → `revokeRefreshTokens` → `deleteUser`. Disable is
  applied first so that even a failed attempt leaves the identity disabled
  rather than active. `auth/user-not-found` anywhere in the sequence is
  idempotent success — the crash-after-delete window converges cleanly on the
  next attempt.
- **Immediate attempt + durable sweep.** The merge request attempts
  reconciliation in-line right after commit (most merges finish there).
  Anything unresolved is picked up by the protected hourly cron
  `GET /api/cron/merge-auth-reconciliation` (`CRON_SECRET`-authorized, same as
  the other crons) with a bounded batch.
- **Lease-guarded concurrency**, modeled on the notification outbox
  (ADR 0017): a Firestore transaction claims work (`processing` +
  `leaseOwner` + `leaseExpiresAt`), Auth calls run **outside** any
  transaction, and a second lease-guarded transaction records the outcome. An
  expired lease means the worker died mid-attempt and the work is reclaimable;
  a newer worker's lease is never clobbered.
- **Bounded retry.** Transient Auth failures retry on an exponential backoff
  schedule (~1m/5m/15m/1h/4h/12h with ±20% jitter, 7 attempts ≈ 18h horizon),
  then become terminal `failed` (`max_attempts`). `permission`,
  `configuration`, and `invalid_record` failures are terminal immediately —
  they need a human, not a retry. Only sanitized failure categories are
  stored; never a provider payload, token, or PII.
- **`failed` is terminal for automatic retry only, not for security.** The
  merged-away identity remains application-rejected (and normally disabled) so
  a terminal record is an operator-actionable state, not an unsafe one.
  Operators see unresolved work on `/admin/users/merge` and can manually
  retry, which re-queues with a fresh attempt budget without bypassing lease
  safety.
- **Legacy records** (`accountMergeEvents` written before this mechanism, or
  with no `authReconciliation` sub-record) are treated as unresolved pending
  work by the sweep, and the merged-away marker is backfilled onto the
  duplicate's `users` document on first claim — so pre-existing unreconciled
  merges are healed automatically.

This is deliberately **not** a generic saga framework: it is one purpose-built
state machine for one cross-system boundary.

## Alternatives considered

- **Status quo (best-effort delete + manual cleanup).** Rejected — that is the
  defect being fixed; the duplicate identity could authenticate indefinitely.
- **Blocking the merge on Auth deletion.** Rejected — would couple an atomic
  Firestore commit to an external service that can never join the transaction,
  and would turn an Auth outage into a failed merge with rolled-back intent
  (or worse, a half-applied merge).
- **Delete only, without disable/revoke.** Rejected — a deletion that keeps
  failing would leave the identity *active*; disabling first bounds the damage
  of every subsequent failure, and revocation bounds the life of already-issued
  credentials.
- **Rely solely on Auth disable/delete for safety (no `mergedIntoUserId`
  check).** Rejected — Auth-state propagation and credential-invalidation
  timing are outside our control; the application-authoritative marker is what
  guarantees the invariant "from commit onward," independent of Firebase.
- **A broad session denylist.** Rejected — a per-uid check derived from the
  authoritative merge record is narrower and self-maintaining; the marker is
  written atomically with the merge, not maintained separately.
- **Reusing the notification outbox collection.** Rejected — merge
  reconciliation is a distinct domain with different semantics (identity
  lifecycle, not message delivery); the outbox informed the *pattern* (claim →
  act → record under a lease) but sharing the collection would entangle
  unrelated invariants.

## Consequences

- **The invariant is now layered.** The merged-away identity is rejected at
  the application boundary from commit time (primary control), is disabled
  and revoked at the first successful Auth contact (defense in depth), and is
  eventually deleted (the clean terminal state). No single Auth failure can
  silently re-open access.
- **An operator-visible terminal state exists.** `failed` records surface on
  the admin merge page with counts, age, and a sanitized failure category;
  the production integrity diagnostic (#52) also reports unresolved/stale and
  inconsistent reconciliation state.
- **Honest limits.** The guarantee is at-least-once convergence, not
  exactly-once cross-system behavior — a crash can still leave a window where
  the Auth identity exists, but that window is covered by the
  application-level rejection and bounded by disable-first ordering. Actual
  Auth-side convergence latency depends on the cron cadence (hourly) plus
  backoff; Auth emulator tests prove the mechanics, but production acceptance
  of the real Firebase Auth behavior remains a staging item (#83).
- **A composite Firestore index** on `accountMergeEvents`
  (`duplicateAuthDeleted` + `createdAt`) is required for the sweep query and
  must be deployed before the cron is effective in production.
- **Merge UX is honest.** The admin result distinguishes "Firestore merge
  committed" from "Auth reconciliation reconciled / pending / failed" — it no
  longer implies the duplicate Auth identity is already gone.

## Operational implications

- **Never remove the `mergedIntoUserId` rejection** from `getSessionUser()`
  or the session-creation route — it is the authoritative interim safety
  control and is what makes `failed` a safe terminal state.
- **Never weaken `verifySessionCookie(cookie, true)` or
  `verifyIdToken(token, true)`** — the `true` enables disabled/revoked checks
  that the Auth-side convergence relies on.
- **`accountMergeEvents` stays deny-by-default** in Firestore rules; all
  reconciliation state is server-only. Logs carry opaque uids/event ids and
  sanitized categories only.
- **Deploy the new composite index** with the release; the sweep silently
  finds nothing without it (the query fails rather than scanning wrongly, but
  the cron then reports errors instead of reconciling).
- **`CRON_SECRET` must be configured**; the route fails closed without it.
  The schedule may be adjusted freely — `nextAttemptAt` is a lower bound, so
  cadence affects timeliness only.
- **Manual retry** (`/admin/users/merge`) is admin-only, idempotent, and
  revalidates the merge record — it cannot reopen the Firestore merge or
  touch the survivor account.

## References

- `src/lib/domain/mergeReconciliation.ts` — claim/act/record orchestration,
  sweep, operator surface.
- `src/lib/domain/mergeReconciliationPolicy.ts` — pure state machine, backoff,
  failure classification.
- `src/lib/domain/identity.ts` (`mergeUserAccounts`) — merge transaction and
  the post-commit attempt.
- `src/lib/auth/session.ts`, `src/app/api/auth/session/route.ts` — the two
  merged-away rejection boundaries.
- `src/app/api/cron/merge-auth-reconciliation/route.ts`, `vercel.json` —
  protected sweep.
- `src/app/admin/users/merge/` — operator visibility + manual retry.
- `firestore.rules`, `firestore.indexes.json` — deny-by-default + sweep index.
- Tests: `mergeReconciliation.emulator.test.ts`,
  `mergeAuthReconciliation.auth-emulator.test.ts`,
  `mergeReconciliationPolicy.test.ts`, `mergeAtomicAudit.emulator.test.ts`,
  `phantomAdmin.emulator.test.ts`, `session.test.ts`, session-route tests,
  cron-route tests.
- [ADR 0017](./0017-notification-outbox-and-retry.md) — the lease/worker
  pattern this mirrors (separate domain, same shape).
- Issue [#73](https://github.com/spizeck/saba-water-delivery/issues/73).

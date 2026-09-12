# 0015. Fixed Saba operational timezone (America/Puerto_Rico)

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-18;
  records an existing decision)

## Context

Several rules are **calendar-day** based rather than rolling-window: the driver
decline count and daily cooldown ([0007](./0007-dispatch-fairness-and-preferred-driver-policy.md)),
the nightly continuity report schedule, and day-oriented statistics. "What day is
it?" must be answered consistently for everyone in the operation, regardless of
where a server or user happens to be, or these rules would behave differently by
locale and around midnight.

## Decision

Use a single, fixed **operational timezone: `America/Puerto_Rico`**
(`appConfig.operationalTimezone`). Saba observes a **fixed UTC−4 offset
year-round with no daylight saving**, so this timezone is a stable, correct proxy
for Saba local time. All calendar-day logic (start/end of the Saba day, decline
counting, daily cooldowns, report scheduling, day-based statistics) is computed
against this timezone rather than the server's or the client's local time. The
nightly continuity cron is scheduled in UTC (`0 0 * * *`) to line up with 8:00 PM
Saba time.

## Alternatives considered

- **Server/UTC time:** rejected — midnight boundaries would not match the
  operational day on the island; a decline "today" could roll over at the wrong
  moment.
- **Per-user/client-local time:** rejected — fairness and daily limits must be
  the same for all drivers, not dependent on a device's timezone.
- **A DST-observing zone:** unnecessary — Saba does not observe DST; a fixed
  UTC−4 zone (`America/Puerto_Rico`) avoids DST edge cases entirely.

## Consequences

- Day-boundary behavior is deterministic and identical for all users.
- The Vercel cron's UTC schedule is tied to the fixed offset; because there is no
  DST, it never needs seasonal adjustment.
- Any future locale change (unlikely for a single-island service) would be a
  single-config change but would shift all day boundaries — hence worth an ADR.

## Operational implications

- Do not replace timezone-aware day math with naive server/UTC dates; it would
  silently move decline/cooldown/report boundaries.
- If Vercel cron plan limits or timing change, re-derive the schedule from the
  fixed UTC−4 offset (see [`../DEPLOYMENT.md`](../DEPLOYMENT.md) "Cron").

## References

- [`src/lib/domain/config.ts`](../../src/lib/domain/config.ts)
  (`operationalTimezone: "America/Puerto_Rico"`),
  [`src/lib/utils/datetime.ts`](../../src/lib/utils/datetime.ts)
- [`vercel.json`](../../vercel.json) (nightly cron)
- TECHNICAL.md "Saba Operational Timezone"

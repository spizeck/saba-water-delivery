# Administrator Guide

[Home](Home.md) · Detailed procedures: [canonical Administrator Guide](https://github.com/spizeck/saba-water-delivery/blob/main/docs/ADMIN_GUIDE.md)

## Accounts and roles

Use an individual account for each administrator so actions can be attributed. A person can have multiple roles and switch between authorized portals without separate accounts.

| Role       | Purpose                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| Resident   | Baseline role; manage personal requests and delivery reviews.                 |
| Driver     | Access driver functions; operational eligibility still requires the Registry. |
| Dispatcher | Coordinate requests, assignments, runs, and disputes.                         |
| Admin      | Dispatcher capabilities plus user, Registry, and settings management.         |
| Viewer     | Read-only oversight with reduced personal detail; no operational changes.     |

User Management can add/remove viewer, dispatcher, and admin roles. The baseline resident role cannot be removed. Driver role changes belong to Registry linking/unlinking. Application admin access does not grant Firebase, Vercel, DNS, or other infrastructure access; those memberships are part of [Production Handover](Production-Handover.md).

Self-removal of admin access is blocked, and the system refuses any action that would remove the last **usable** admin — whether by removing the admin role or by merging accounts. (A merge deletes the login of the account being merged away, so it also revokes that account's admin role: a merged-away account can never linger as an administrator that can no longer sign in.) The check is enforced inside each action's transaction and is safe even when such actions happen at the same time: at most one succeeds and at least one usable admin always remains, so administrative access can never be fully locked out. Government emergency-access arrangements remain tracked under [#61](https://github.com/spizeck/saba-water-delivery/issues/61).

## Driver Registry and eligibility

Create a Registry entry for a recognized driver, then link their application account when available. Linking grants the driver role while preserving other roles; it does not grant eligibility. Marking someone eligible is a separate decision.

Normal offers require a Registry entry, linked account with driver role, eligibility, online availability, no cooldown, and no outstanding claimed work. A staff-created Delivery Run deliberately differs from normal offers: offline/cooldown drivers can receive a run when otherwise eligible. See [Dispatcher Guide](Dispatcher-Guide.md).

Restricting eligibility forces the driver offline. Unlinking removes the driver role and forces them offline, preserves history, and is blocked while claimed deliveries remain. Review each fill station's meter assignment when a driver cannot record collection; changing today's assignment does not rewrite past collection records.

## User administration, settings, and history

Historical unregistered requests can be linked after identity review; phone/email matches are suggestions, not proof. Account merges require careful review of the account to keep, roles, and driver links. Use the canonical guide for the exact process and any failed Auth cleanup.

Current Admin dispatch settings control the daily decline limit and cooldown duration. Change them deliberately because they affect fairness and available driver capacity. This is not a general cloud-configuration console; broader configuration validation is tracked in [#54](https://github.com/spizeck/saba-water-delivery/issues/54).

Review request, user-role, and Registry history for who acted and when. Preserve those events during incidents. Durable audit history is separate from diagnostic logs. Required audit events now commit atomically with the sensitive change they record, so a committed change carries its audit history ([#49](https://github.com/spizeck/saba-water-delivery/issues/49)); the sole exception is the external Firebase Authentication account deletion during an account merge, whose outcome is recorded on the merge's audit record on a best-effort basis. That deletion is not disabling — it only removes the login — so if it fails, the merged-away duplicate identity can **still sign in** (with any non-`admin` roles its retained account keeps) until an operator deletes it; a merge audit record showing `duplicateAuthDeleted: false` (or missing that outcome) flags one to clean up. Durable reconciliation of this is tracked in [#73](https://github.com/spizeck/saba-water-delivery/issues/73). Records written before the atomicity fix, or a rare failure to record the external outcome, also mean an absent or incomplete event is not by itself proof that no change occurred. Use [Operations](Operations.md) to escalate discrepancies.

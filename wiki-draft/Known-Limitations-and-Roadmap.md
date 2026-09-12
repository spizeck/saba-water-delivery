# Known Limitations and Roadmap

[Home](Home.md) · [Government Production Readiness](https://github.com/spizeck/saba-water-delivery/milestone/1)

This is a review snapshot dated 12 September 2026. The issues listed below were open when reviewed. They describe work to do, not delivered features or deadlines; follow each issue for current decisions and completion evidence.

| Area                   | Current limitation and operational implication                                                                                        | Issue                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Resident cancellation  | Residents need staff assistance; self-cancellation before dispatch is proposed.                                                       | [#23](https://github.com/spizeck/saba-water-delivery/issues/23) |
| Last-admin concurrency | The ordinary last-admin check does not serialize concurrent removals. Coordinate changes and verify remaining access.                 | [#48](https://github.com/spizeck/saba-water-delivery/issues/48) |
| Audit atomicity        | Some changes and their audit events are separate writes; absence of an event is not proof that no change occurred.                    | [#49](https://github.com/spizeck/saba-water-delivery/issues/49) |
| Unregistered disputes  | Staff can confirm unregistered deliveries and resolve existing disputes, but cannot create an unregistered customer's formal dispute. | [#50](https://github.com/spizeck/saba-water-delivery/issues/50) |
| Integrity diagnostics  | A recovery validator exists; the broader read-only production diagnostic described by this issue is future work.                      | [#52](https://github.com/spizeck/saba-water-delivery/issues/52) |
| Notification retries   | Best-effort notification failure can leave a message unsent; a durable outbox/retry mechanism is proposed.                            | [#53](https://github.com/spizeck/saba-water-delivery/issues/53) |
| Central configuration  | Configuration is spread across modules and deployment settings; a successful build does not prove operational completeness.           | [#54](https://github.com/spizeck/saba-water-delivery/issues/54) |

Government ownership work covers [Firebase/GCP #56](https://github.com/spizeck/saba-water-delivery/issues/56), [Vercel #57](https://github.com/spizeck/saba-water-delivery/issues/57), [Resend #58](https://github.com/spizeck/saba-water-delivery/issues/58), [DNS #59](https://github.com/spizeck/saba-water-delivery/issues/59), [backups #60](https://github.com/spizeck/saba-water-delivery/issues/60), [technical administrators #61](https://github.com/spizeck/saba-water-delivery/issues/61), [monitoring #62](https://github.com/spizeck/saba-water-delivery/issues/62), and [the acceptance drill #63](https://github.com/spizeck/saba-water-delivery/issues/63). [Production Handover](Production-Handover.md) explains the expected outcomes.

Other current boundaries in [PRODUCT.md](https://github.com/spizeck/saba-water-delivery/blob/main/PRODUCT.md) include no offline transactions, no scheduled delivery slots, no arbitrary quantities or partial-delivery lifecycle, and photo uploads as future work. Facebook is disabled; WhatsApp ordering code exists but remains a future feature, unavailable to live residents as clarified by the project owner. Production credentials have not been inspected. See [Integrations](Integrations.md) before describing either as available to residents.

The documentation itself has stale or contradictory passages. The [review notes](README.md) identify those that affect this draft. This page makes no commitments about delivery dates, government approvals, legal ownership, or production certification.

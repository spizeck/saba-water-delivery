# Saba Water Delivery

Saba Water Delivery coordinates requests for government-produced RO water on Saba. Residents request water, drivers collect and deliver it, and Public Entity Saba staff oversee assignments and delivery records in one shared system.

> **Technical pilot — status reviewed 12 September 2026.** This service is currently operating as a technical pilot on developer-managed infrastructure while Public Entity Saba prepares for institutional production ownership. Core application workflows are operational in the pilot. Government control of Firebase/GCP, Vercel, transactional email infrastructure, the public domain, production backup protections, monitoring, and other operational ownership areas remains work to complete and verify. This is not a declaration of institutional production readiness.

The [repository overview](https://github.com/spizeck/saba-water-delivery/blob/main/README.md) records the pilot, and [Production Handover](Production-Handover.md) links to the open ownership work and explains the evidence behind this notice. Backup activation and government handover have not been established by this documentation review.

Use the [pilot application](https://saba-water-delivery.vercel.app). Residents and drivers can install the same web app through `/resident/install` and `/driver/install`. Installation uses the existing account; current information and updates need an internet connection.

## Find the right page

| Your task                                                   | Start here                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Request water or review a delivery as a resident            | [Resident Workflow](Resident-Workflow.md)                         |
| Manage requests, assignments, runs, and disputes            | [Dispatcher Guide](Dispatcher-Guide.md)                           |
| Receive offers, collect water, and record delivery          | [Driver Guide](Driver-Guide.md)                                   |
| Manage users, roles, and the Driver Registry                | [Administrator Guide](Administrator-Guide.md)                     |
| Monitor the day or report an operational problem            | [Operations](Operations.md)                                       |
| Prepare government ownership and acceptance                 | [Production Handover](Production-Handover.md)                     |
| Understand recovery after data loss                         | [Disaster Recovery](Disaster-Recovery.md)                         |
| Understand statuses, fairness, and delivery accountability  | [System Concepts](System-Concepts.md)                             |
| Check which communications and login services are available | [Integrations](Integrations.md)                                   |
| Understand current gaps and future work                     | [Known Limitations and Roadmap](Known-Limitations-and-Roadmap.md) |

Residents manage their own requests. Drivers handle physical deliveries. Dispatchers coordinate operations. Administrators also manage access and settings. Viewers have read-only oversight with limited personal information. One account can hold several roles; the portal switcher opens the views that account is authorized to use.

These pages are an operator-facing draft. Repository documentation remains authoritative for implementation, exact procedures, deployment, testing, and architectural decisions. See the [draft maintenance notes](README.md) for sources and review findings.

# 0001. Firebase as the data and authentication platform

- **Status:** Accepted
- **Date:** ADR recorded 2026-09-12 (decision originally made 2026-08-17, the
  initial commit; records an existing decision)

## Context

Saba Water Delivery is a small government water-delivery coordination system for
a single Caribbean island, built and operated by a volunteer for the Public
Entity Saba with an expected small user base (residents, a handful of drivers,
and dispatch/admin staff). It needs authenticated users, a document/record store
with real-time-friendly reads, trusted server-side operations, and low
operational overhead for a future government maintainer. It is deployed as a
single web application (see [0002](./0002-nextjs-app-router-vercel-deployment.md)).

## Decision

Use **Google Firebase** as the application data and authentication platform:

- **Cloud Firestore** (Native mode) as the authoritative datastore for all
  business data (users, water requests and their events, driver registry, fill
  stations, dispatch offers, delivery runs, config).
- **Firebase Authentication** for user identity (Google and email/password
  today; Facebook is scaffolded but shown "Coming Soon").
- The **Firebase Admin SDK** for all trusted server-side operations (see
  [0003](./0003-server-authoritative-mutation-model.md)).
- **Firebase Storage** is provisioned with deny-by-default rules but **not used
  in production yet** — photo upload is a future phase.

No relational database (Postgres) and no ORM (Prisma) are used.

## Alternatives considered

- **PostgreSQL + Prisma** (the `business-app-foundation` pattern): a stronger fit
  for complex relational reporting, but adds a managed SQL dependency, migrations,
  and a separate auth solution. Overkill for this app's scale and would raise the
  operational burden for a government handover. Not chosen.
- **A self-hosted database / custom auth:** rejected — far more to secure,
  operate, and back up than a managed platform for a volunteer-built system.
- **Supabase / other BaaS:** viable, but Firebase's Auth + Firestore + Admin SDK
  combination was already the most direct fit and keeps identity and data on one
  managed platform.

## Consequences

- Low operational overhead: managed auth, managed datastore, managed backups/PITR
  (see [0014](./0014-backup-and-disaster-recovery-strategy.md)).
- Firestore's document model shapes the data design (denormalized snapshots,
  subcollections for events) rather than relational joins; see
  [`../DATA_MODEL.md`](../DATA_MODEL.md) and TECHNICAL.md "Suggested Firestore Model".
- The Admin SDK **bypasses Firestore security rules**, which is central to the
  security model and must be understood before changing it — see
  [0003](./0003-server-authoritative-mutation-model.md).
- Vendor coupling to Google Cloud. Acceptable for the scale; recovery/portability
  considerations are documented in [0014](./0014-backup-and-disaster-recovery-strategy.md).

## Operational implications

- The project id lives in [`.firebaserc`](../../.firebaserc) (`saba-water-delivery`);
  Admin credentials and public client config are environment variables, never
  committed (see [`../DEPLOYMENT.md`](../DEPLOYMENT.md) and `.env.example`).
- Do **not** introduce Postgres/Prisma or a second datastore without a new,
  superseding ADR — it would fork the persistence architecture.
- Storage backup/versioning is only relevant once photos ship
  ([0014](./0014-backup-and-disaster-recovery-strategy.md) §Storage).

## References

- [`src/lib/firebase/admin.ts`](../../src/lib/firebase/admin.ts),
  [`src/lib/firebase/client.ts`](../../src/lib/firebase/client.ts)
- [`firestore.rules`](../../firestore.rules), [`storage.rules`](../../storage.rules),
  [`firestore.indexes.json`](../../firestore.indexes.json)
- TECHNICAL.md "Architecture", "Suggested Firestore Model", "Firebase Storage"
- Related: [0003](./0003-server-authoritative-mutation-model.md),
  [0004](./0004-authentication-and-session-architecture.md)

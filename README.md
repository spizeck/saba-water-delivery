# Saba Water Delivery

A Government of Saba system for requesting and dispatching government
RO water deliveries. It replaces the previous process where residents
called individual drivers directly: a resident requests a standard
1,000-gallon load, an eligible driver claims and delivers it, and
government staff retain full operational visibility over the process.

## Interfaces

- **Resident** (`/resident`) — request water, manage delivery
  information, confirm or dispute deliveries.
- **Driver** (`/driver`) — go online/offline, receive and respond to
  one delivery offer at a time, deliver water.
- **Dispatcher** (`/dispatcher`) — operational oversight, manual
  requests for callers/walk-ins, assignment, dispute handling,
  continuity reports.
- **Admin** (`/admin`) — user roles, Driver Registry, dispatch
  settings.
- **Viewer** (`/viewer`) — read-only operational oversight for
  government staff who do not need operational control.
- **WhatsApp** — residents can also request water and manage an
  existing request by messaging the government WhatsApp number; it is
  a front end to the same request system, not a separate one.

## Technology

- Next.js (App Router) and TypeScript
- Firebase Authentication (Google, Facebook, email/password)
- Cloud Firestore (source of truth) and Firebase Storage
- Vercel (hosting, cron)
- Resend (transactional email)
- Meta WhatsApp Business Platform / Cloud API (WhatsApp ordering)

## Documentation map

| Document | Contents |
| --- | --- |
| [`PRODUCT.md`](./PRODUCT.md) | Authoritative business rules and product behavior. |
| [`TECHNICAL.md`](./TECHNICAL.md) | Architecture, data model, and implementation reference. |
| [`DEVIN.md`](./DEVIN.md) | Development guide, conventions, and build philosophy. |
| [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) | Plain-English daily operations workflow for government staff. |
| [`docs/ADMIN_GUIDE.md`](./docs/ADMIN_GUIDE.md) | How to manage users, the Driver Registry, and dispatch settings. |
| [`docs/DISPATCHER_GUIDE.md`](./docs/DISPATCHER_GUIDE.md) | Practical guide to the dispatcher dashboard and daily tasks. |
| [`docs/DRIVER_GUIDE.md`](./docs/DRIVER_GUIDE.md) | Simple guide for water delivery drivers. |
| [`docs/INCIDENT_RECOVERY.md`](./docs/INCIDENT_RECOVERY.md) | What to do during outages or a suspected security incident. |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | How to reproduce and configure the production deployment. |
| [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) | Canonical Firestore collections and their fields/relationships. |
| [`docs/TESTING.md`](./docs/TESTING.md) | Verification commands and a manual pre-deployment smoke test. |
| [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) | Every external service integration in one place. |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | Production-facing changelog going forward. |

## Development quick start

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Without
Firebase environment variables configured, the app still builds and
runs, showing a clear "not configured" state instead of failing.

```bash
npm run lint    # ESLint
npm run build   # Production build (webpack, also runs the TypeScript compiler)
npm run test    # Vitest
```

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for environment
variables and production setup, [`TECHNICAL.md`](./TECHNICAL.md) for
architecture, and [`docs/TESTING.md`](./docs/TESTING.md) for the full
verification and smoke-test process.

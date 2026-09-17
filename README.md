# Saba Water Delivery

Saba Water Delivery is a system for requesting and dispatching
government-produced RO water deliveries on Saba. It replaces the previous
process where residents called individual drivers directly: a resident
requests a standard 1,000-gallon load, an eligible driver claims and
delivers it, and government staff retain full operational visibility
over the process.

The application is live as a pilot at
[`https://saba-water-delivery.vercel.app`](https://saba-water-delivery.vercel.app).
Residents and drivers can install the same Progressive Web App from
`/resident/install` or `/driver/install`; a permanent government domain will
replace the Vercel hostname after DNS is configured.

## Project Provenance and Handover

Saba Water Delivery was developed on a volunteer basis for the Public
Entity Saba. The application's requirements, workflows, operational
rules, and subsequent changes were developed in consultation with and
under the supervision and approval of representatives of the Public
Entity Saba.

The project is intended to be handed over to the Public Entity Saba for
its ownership, administration, continued development, and operation.
The repository and its documentation are therefore written to support
government staff and future technical maintainers rather than continued
dependence on the original volunteer developer.

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
- **WhatsApp (future resident feature)** — ordering and webhook code exist,
  but automated ordering is not available to live residents. Production Meta
  provisioning/configuration must be verified before launch; an office contact
  number is not evidence that automated ordering is enabled.

## Technology

- Next.js (App Router) and TypeScript
- Firebase Authentication — Google and email/password (Facebook is scaffolded
  but disabled/"Coming Soon" pending Meta verification)
- Cloud Firestore (source of truth). Firebase Storage is provisioned with
  deny-by-default rules but not yet used — photo upload is a future phase.
- Vercel (hosting, cron)
- Resend (transactional email)
- Meta WhatsApp Business Platform / Cloud API (WhatsApp ordering)

## Documentation map

Each document below is the **authoritative source** for its subject; other
documents link to it rather than restating its rules. Find the right one by what
you need to do:

| I need to… | Document | Audience |
| --- | --- | --- |
| Understand the product rules and workflows | [`PRODUCT.md`](./PRODUCT.md) | Product / staff / developers |
| Learn the architecture and implementation | [`TECHNICAL.md`](./TECHNICAL.md) | Developers |
| Understand the Firestore data model | [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) | Developers |
| Understand *why* a major decision was made | [`docs/adr/`](./docs/adr/README.md) | Developers / maintainers |
| Work on the code (conventions, build philosophy) | [`DEVIN.md`](./DEVIN.md) | Developers / AI-assisted work |
| Contribute a change, report a bug, or open a PR | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Contributors / maintainers |
| Deploy or configure production (env vars, release flow, branch protection) | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Deployer / IT admin |
| Run tests and verification | [`docs/TESTING.md`](./docs/TESTING.md) | Developers |
| Operate production day to day | [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) | Government staff |
| Respond to an outage or suspected security incident | [`docs/INCIDENT_RECOVERY.md`](./docs/INCIDENT_RECOVERY.md) | Operators / IT admin |
| Back up or restore data after loss/corruption | [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md) | IT admin |
| Transfer Firebase/GCP ownership to the government | [`docs/FIREBASE_GCP_HANDOVER.md`](./docs/FIREBASE_GCP_HANDOVER.md) | IT admin / government |
| Manage users, the Driver Registry, and dispatch settings | [`docs/ADMIN_GUIDE.md`](./docs/ADMIN_GUIDE.md) | Administrators |
| Use the dispatcher dashboard | [`docs/DISPATCHER_GUIDE.md`](./docs/DISPATCHER_GUIDE.md) | Dispatchers |
| Use the driver app | [`docs/DRIVER_GUIDE.md`](./docs/DRIVER_GUIDE.md) | Drivers |
| Understand external service integrations | [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) | Developers / IT admin |
| See what changed in production | [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | Everyone |

Security policy and reporting: [`SECURITY.md`](./SECURITY.md).

## Development quick start

This project targets **Node.js 24** (pinned in `.nvmrc` and
`package.json` `engines`, matching the Vercel production runtime). With
`fnm` or `nvm`, run `fnm use` / `nvm use` to select it.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Without
Firebase environment variables configured, the app still builds and
runs, showing a clear "not configured" state instead of failing.

Run the full non-destructive verification suite before opening a pull
request:

```bash
npm run check   # format:check + lint + typecheck + Vitest + production build (incl. PDFKit trace check)
```

Individual steps are also available (`npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm run test`, `npm run build`). The Firestore/Storage
security-rules tests and the Playwright end-to-end suite need the Firebase
emulators and a JVM and are run separately:

```bash
npm run test:rules   # Firestore/Storage security-rules tests (emulators)
npm run test:e2e     # Playwright end-to-end tests (Auth + Firestore emulators)
```

Every pull request and push to `main` is verified by GitHub Actions. Two
status checks are required on `main`: **`verify`** (workflow `CI`, displayed as
`CI / verify`) and **`playwright`** (workflow `E2E`, displayed as
`E2E / playwright`). See [`docs/TESTING.md`](./docs/TESTING.md) for the full
verification reference and CI details, [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)
for environment variables, the release flow, and branch protection, and
[`TECHNICAL.md`](./TECHNICAL.md) for architecture.

# Contributing

This repository contains **Saba Water Delivery** — the system for
requesting and dispatching government-produced RO water deliveries on
Saba. It was developed on a volunteer basis for the **Public Entity
Saba** and is intended for government ownership, administration, and
continued development (see [`README.md`](./README.md) "Project
Provenance and Handover").

This file covers **how to contribute**. What the system does and how it
is built is documented elsewhere — each document below is the
authoritative source for its subject. Read the relevant ones instead of
inferring behavior from the code:

| Subject | Document |
| --- | --- |
| Product rules and workflows | [`PRODUCT.md`](./PRODUCT.md) |
| Architecture and implementation | [`TECHNICAL.md`](./TECHNICAL.md) |
| Firestore data model | [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) |
| Code conventions and development philosophy | [`DEVIN.md`](./DEVIN.md) |
| Testing and CI | [`docs/TESTING.md`](./docs/TESTING.md) |
| What production behavior each test proves | [`docs/PRODUCTION_READINESS_TEST_MATRIX.md`](./docs/PRODUCTION_READINESS_TEST_MATRIX.md) |
| Staging acceptance and production smoke | [`docs/ACCEPTANCE_TESTING.md`](./docs/ACCEPTANCE_TESTING.md) |
| Deployment, environment variables, branch protection | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) |
| Day-to-day operations | [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) |
| Outage and incident procedures | [`docs/INCIDENT_RECOVERY.md`](./docs/INCIDENT_RECOVERY.md) |
| External integrations | [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) |
| Why major decisions were made (ADRs) | [`docs/adr/`](./docs/adr/README.md) |
| Security policy | [`SECURITY.md`](./SECURITY.md) |

## Before making a change

- **Search existing issues and pull requests** — the work may already be
  planned, in progress, or deliberately rejected.
- **Read the documentation and ADRs for the workflow you are touching.**
  Several ADRs record dangerous-looking decisions that are intentional
  (see the "Especially dangerous assumptions" list in
  [`docs/adr/README.md`](./docs/adr/README.md)).
- **Open or reference an issue** for any substantive change. The issue
  forms under "New issue" capture the information reviewers need. Trivial
  fixes (typos, broken links) can go straight to a PR.
- **Keep the change focused.** Do not combine unrelated work in one PR.
- **Identify implications before implementing**: security, privacy,
  data-model, operational, and migration concerns shape the right
  approach — see the sections below.

## Branch and pull-request workflow

1. Start from current `main` (`git checkout main && git pull`).
2. Create a focused branch — existing conventions are
   `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<slug>`, and
   `feature/<slug>`.
3. Make the smallest coherent change.
4. Add or update tests at the appropriate layer (see "Testing" below).
5. Update documentation when behavior changes (see "Documentation and
   ADRs" below).
6. Run the relevant verification.
7. Open a pull request and fill in the template. Link the issue with
   closing syntax (`Closes #123`) so merging closes it.
8. Resolve review conversations — the `main` ruleset requires
   conversation resolution before merge.
9. Wait for the required status checks to pass — the required
   status-check contexts are **`verify`** and **`playwright`**,
   displayed in GitHub as `CI / verify` and `E2E / playwright` — plus a
   successful **Vercel Preview** deployment for runtime changes.
10. Merge only after review requirements are satisfied — the ruleset
    requires a pull request and one approving review, dismisses stale
    approvals on new pushes, and blocks force pushes to `main`.

Required checks and review requirements are enforced by the "Protect
Main" ruleset; they cannot be bypassed from a PR. See
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) "Continuous integration and
branch protection" for the authoritative description.

## Dependency updates

Dependabot runs weekly for npm and GitHub Actions
([`.github/dependabot.yml`](./.github/dependabot.yml)). Routine version
updates are grouped by risk class (framework, Firebase client SDK, type
packages, dev/emulator tooling, lint/test tooling) so each PR maps to one
review strategy; runtime-critical packages such as `firebase-admin` and
`resend` stay ungrouped. Major-version updates are never grouped and are
never auto-merged.

- **Runtime dependency changes require full verification** — `npm run
  check` plus the emulator suites that cover the touched surface, and a
  review of the Vercel Preview deployment.
- **Serverless-runtime-sensitive upgrades** (`firebase-admin` above all)
  additionally require exercising the actual Vercel Preview runtime, not
  only local/emulator tests: `firebase-admin` 14 passed every local and
  CI check and still broke production with `ERR_REQUIRE_ESM` (#94).
- **Runtime dependency changes belong in an intentional release
  baseline.** Application versions are assessed snapshots (see
  [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) "Release policy"), so a
  dependency change that alters shipped runtime should land ahead of the
  next intended release rather than silently changing an assessed one.

## Testing

The canonical reference is [`docs/TESTING.md`](./docs/TESTING.md). In
short:

- `npm run check` — Prettier, ESLint, `tsc`, the Vitest unit/domain
  suite, and the production build (including the PDFKit trace check).
  No credentials or live services needed. **Run this before every PR.**
- `npm run test:rules` — Firestore/Storage security-rules tests against
  the local Firebase emulators (needs a JVM). Run when a change touches
  `firestore.rules`, `storage.rules`, or data access patterns.
- `npm run test:e2e` — the Playwright browser suite against local Auth +
  Firestore emulators (needs a JVM and Chromium). Run when a change
  touches a covered user journey.
- `npm run docs:check-links` — validates internal Markdown links and
  anchors. Advisory (not wired into CI); run it when you edit docs.

Match the test layer to the change:

- Pure domain/business logic → Vitest unit tests.
- Client data access and rules behavior → Firestore emulator and
  security-rules tests.
- Server/API boundaries → Vitest route tests (mock only the network
  boundary).
- Browser-level user journeys → Playwright — but do not add Playwright
  coverage where a lower-level test gives stronger, more maintainable
  coverage.
- External-service behavior → the controlled acceptance paths documented
  in [`docs/TESTING.md`](./docs/TESTING.md); never test against
  production.

Bug fixes should include a regression test where practical — one that
fails without the fix. Broader test-coverage gaps are tracked in #67.

When a change adds a supported workflow, integration, or production
boundary — or changes how an existing one is verified — update
[`docs/PRODUCTION_READINESS_TEST_MATRIX.md`](./docs/PRODUCTION_READINESS_TEST_MATRIX.md)
in the same PR. The matrix is the maintained record of which production
behaviors are verified and how; keeping it current is part of the change.

## Security and privacy

- **Never commit secrets** — tokens, credentials, private keys, or real
  `.env` contents. `.env.local` is gitignored;
  [`.env.example`](./.env.example) documents keys with placeholder
  values only.
- **Never use real resident/customer personal information** in test
  fixtures, seeds, screenshots, or issue reports. All test data is
  synthetic.
- **Never use production data in automated tests**, and never point
  local or E2E automation at production infrastructure — the suites are
  emulator-only by design (`e2e/support/safety.ts` fails loudly
  otherwise).
- **Do not weaken safeguards to make tests pass** — authorization,
  Firestore Security Rules, rate limiting, logging redaction, and
  similar controls are load-bearing.
- Changes touching **authentication, authorization, roles, resident
  data, audit history, or data integrity are security-sensitive** — say
  so explicitly in the PR's security section.
- **Do not post exploit details, secrets, or resident/customer PII in a
  public issue.** [`SECURITY.md`](./SECURITY.md) is the repository's
  security policy; it does not yet define a private reporting channel,
  so raise suspected vulnerabilities with the maintainers directly
  rather than disclosing them publicly.

## Firestore and data changes

Firestore is the application's source of truth and holds production
government service data. Before changing schema, rules, indexes, or
access patterns, work through
[`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) and consider:

- **Existing production data** — is the change backward compatible with
  records already stored? If not, what migration or backfill is needed,
  and how is it verified?
- **Security Rules** — client-side rules in `firestore.rules` and
  `storage.rules` are a client boundary; the **Admin SDK bypasses them
  entirely**, so server code must enforce authorization itself
  ([ADR 0003](./docs/adr/0003-server-authoritative-mutation-model.md)).
- **Indexes** — new query patterns may need entries in
  `firestore.indexes.json`.
- **Concurrency and transaction boundaries** — multi-document invariants
  must be enforced inside a transaction; see [`TECHNICAL.md`](./TECHNICAL.md).
- **Audit history** — state transitions that matter operationally
  produce audit events; preserve that behavior.
- **Recovery and rollback** — what happens if the change ships wrong?
  See [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md).

Note: **deleting a Firestore document does not delete its
subcollections.** Removing data requires deleting subcollection
documents explicitly.

## External integrations

Firebase, Vercel, Resend, Meta/WhatsApp/Facebook, and DNS behavior are
documented in [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md). When
describing or changing integration behavior, distinguish five states
that are easy to conflate:

- **implemented** in code
- **configured** (environment variables/secrets set)
- **enabled** (turned on for users)
- **tested** (verified end to end)
- **production-available**

Code existing in the repository is not evidence of production
configuration — WhatsApp ordering, for example, is implemented but not
available to live residents. Do not infer production state from source.

## Documentation and ADRs

- **Behavior changes update the canonical documentation** listed in the
  table above — the same PR, not a follow-up.
- **Architecturally significant decisions add or supersede an ADR** per
  the rules in [`docs/adr/README.md`](./docs/adr/README.md) (when to
  write one, the template, numbering, and updating the index).
- **Do not rewrite accepted ADR history.** When a decision changes, a
  new ADR supersedes the old one; the old record stays.

## Scope discipline

Keep PRs focused on their issue. If the work uncovers a separate defect
or architectural concern, open or link a follow-up issue rather than
silently expanding scope — unless the additional fix is required for the
change to be correct.

<!--
Fill in what applies — a documentation typo and a Firestore migration
should not need the same amount of detail. The workflow is documented in
`CONTRIBUTING.md`; the verification reference is `docs/TESTING.md`.
-->

## Summary

<!-- What changed and why? Link the docs or ADR if they define the expected behavior. -->

## Related issue

<!-- Required for substantive changes; closing syntax auto-links. -->

Closes #

## Change type

- [ ] Bug fix
- [ ] Feature / enhancement
- [ ] Reliability
- [ ] Security
- [ ] Operations / infrastructure
- [ ] Documentation
- [ ] Refactor / maintenance

## Affected areas

- [ ] Resident
- [ ] Driver
- [ ] Dispatcher
- [ ] Administrator
- [ ] Viewer
- [ ] Authentication / authorization
- [ ] Firestore / data
- [ ] Notifications / integrations
- [ ] Operations / deployment
- [ ] Documentation only

## Testing

<!-- Check only what applies. Required checks (`CI / verify`,
`E2E / playwright`) run in CI regardless — this section records what you
verified locally and where reviewers should look. See `docs/TESTING.md`. -->

- [ ] `npm run check` — format, lint, typecheck, unit tests, production build
- [ ] `npm run test:rules` — Firestore/Storage rules tests (emulators)
- [ ] `npm run test:e2e` — Playwright suite (emulators)
- [ ] `npm run docs:check-links` — Markdown link check
- [ ] Manual / acceptance testing — describe below
- [ ] Not applicable — explain below

<!-- Test notes: -->

## Data / migration impact

<!-- Firestore schema or data changes, indexes, Security Rules, effects on
existing production records, migrations/backfills. Write `None` if none.
Reminders: the Admin SDK bypasses Security Rules, and deleting a document
does not delete its subcollections. -->

None

## Security / privacy impact

<!-- One sentence, or `None`. Changes to auth, roles, resident data,
audit history, or data integrity are always security-relevant. -->

None

## External service / configuration impact

<!-- New or changed environment variables, Firebase, Vercel, Resend,
Meta/WhatsApp/Facebook, DNS/domain, or other dependencies. Distinguish
implemented vs configured vs enabled vs production-available. `None` if
none. -->

None

## Documentation

<!-- Which docs/ADRs changed, or why none are needed. Behavior changes
update the canonical docs in the same PR; architecturally significant
changes add or supersede an ADR (see `docs/adr/README.md`). -->

## Deployment / rollback

<!-- Default below covers ordinary changes. Note anything unusual: new
env vars, migration ordering, one-time scripts, manual provider config. -->

Standard deployment / normal rollback

## Reviewer notes

<!-- Anything reviewers should specifically verify or watch for. -->

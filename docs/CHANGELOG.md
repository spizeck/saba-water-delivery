# Changelog

This changelog tracks production-facing changes going forward. It does
not attempt to recreate the full prelaunch development history.

## Convention

- Keep an `## Unreleased` section at the top for changes that have
  merged but not yet gone live for government staff.
- When a change goes live, move its entry under a new dated heading,
  e.g. `## 2026-09-01`, in reverse chronological order (newest first).
  A simple date is sufficient; version numbers are not required unless
  the project later adopts formal releases.
- Write entries for staff/operational impact, not implementation
  detail — what changed for residents, drivers, dispatchers, or admins,
  not which files were touched.
- Only add an entry for a change that actually affects production
  behavior (a new feature, a fixed bug, a changed business rule, a
  changed default). Documentation-only or internal refactoring changes
  do not need an entry.

## Unreleased

Initial production preparation, including a full documentation pass
covering operations, administration, dispatching, driving, incident
recovery, deployment, the data model, testing, and external
integrations.

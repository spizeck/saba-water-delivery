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

Operational usability pass following government dispatcher testing.
- Canonical village dropdowns (resident profile, dispatcher request,
  WhatsApp) and server-side validation of the five approved village
  values.
- Fixed active Batch Dispatch detail page by removing the
  orderBy-bucket composite index dependency and sorting in memory.
- Added "View Open Batches" dashboard button.
- Dispatcher/admin can now mark individual batch loads and ordinary
  `claimed` requests as delivered with an audit note.
- New dispatcher escalation action that moves a request ahead in the
  queue without rewriting its original request timestamp.
- Dispatcher-visible warning when a customer has 3 or more requests in
  the last 7 days.
- Responsive Admin portal layout so the View Statistics button is
  visible on mobile.

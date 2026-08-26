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

Quantity model change:
- Residents may now request either 1 load (1,000 gallons) or 2 loads
  (2,000 gallons) in a single request. The choice is required on the
  resident web form, the dispatcher manual-request form, and the
  WhatsApp ordering flow. A two-load request remains one request, one
  priority, one assignment, and one confirmation/dispute record — it is
  not split into two request documents.
- Gallons are derived server-side from `loads`; clients cannot send an
  authoritative gallon value. Statistics now total actual request
  gallons instead of assuming `request count × 1,000`.
- Driver offers, batch dispatch sheets, continuity reports, and all
  request detail/list views display the actual quantity in loads and
  gallons.
- Partial-load fulfillment is not tracked; marking a two-load request
  delivered means the full requested quantity was physically delivered.

Prelaunch cleanup pass:
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
  the last 7 days (now shown during manual request creation and on the
  request detail page).
- Responsive Admin portal layout so the View Statistics button is
  visible on mobile.
- Manual dispatch escalation (`Escalate` on request detail) sorts
  ahead within the same priority without mutating `requestedAt`; multiple
  escalated requests stay oldest-first within equal priority.
- Canonical village list enforced across forms, WhatsApp, and server
  validation; legacy spellings are no longer accepted for new data.
- `scripts/migrate-villages.mjs` one-time dry-run/write migration for
  prelaunch village cleanup.

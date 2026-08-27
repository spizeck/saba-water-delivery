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

Smoke-test fixes:
- Facebook Login is now shown as **Coming Soon** (disabled, greyed out)
  on the login page while Meta business verification is pending. The
  underlying Firebase Facebook provider integration is preserved.
- Stale `activeRequestId` self-healing: if a driver's registry lock
  points to a deleted, delivered, cancelled, confirmed, or reassigned
  request, the system automatically clears it before rendering the
  driver portal, selecting an offer, accepting a delivery, or
  processing a dispatcher assignment. A `stale_active_request_cleared`
  audit event is recorded. Drivers are no longer permanently blocked by
  orphaned prelaunch data.
- New `scripts/reconcile-stale-driver-locks.mjs` diagnostic for
  bulk prelaunch stale-lock identification and cleanup.
- Dispatcher workload view now reconciles stale locks — a driver with
  0 open requests is no longer simultaneously blocked for a nonexistent
  active delivery.
- Logout now uses `router.replace` to prevent the back button from
  returning to the portal after signing out.

Water Collection Tracking:
- Per-load fill station and meter recording before a delivery can be marked
  complete; the delivery is blocked until every load is collected.
- New driver collection UI for recording each load's fill station and meter.
- Dispatcher staff reconciliation for missing load collections, creating an
  audit record.
- Batch dispatch PDF sheets now show per-load collection areas.
- Dispatcher statistics view shows fill-station and meter totals.
- Technical: `WaterLoadCollection` type, `recordWaterCollection` domain
  function, `loadCollection.ts` pure helpers, `water_collected` and
  `water_collected_by_staff` audit events, `DEFAULT_FILL_STATION_ID` constant.

Identity and account management:
- Accounts remain optional for receiving water. Unregistered requestors
  can still request delivery with name and phone only.
- Dispatchers can optionally send a secure account-setup invitation when
  an email address is provided; the request succeeds even if the
  invitation fails.
- Dispatchers are warned when an entered email already matches an
  existing resident account and can choose to use that account.
- Phone matches are surfaced as suggestions only; name-only matches
  never link or merge automatically.
- Admins can link historical unregistered requests to a registered
  account from the user detail page. Original request snapshots are
  preserved; only request ownership (`customerId`) is updated.
- Admins can merge two authenticated accounts via a dedicated merge
  tool. Sensitive roles (admin, dispatcher, driver) do not transfer
  silently; a driver-registry conflict blocks the merge. All merge
  actions are audited.
- New automated tests cover identity matching and account-setup email
  content.

Operational usability pass following government dispatcher testing.

Dispatcher manual-request UX refinement:
- Existing-resident search now collapses into a compact "Selected
  requestor" card with a **Change** action to reopen the search.
- Requestor terminology replaces "Customer" on the dispatcher request
  form, selected card, and review screen.
- Saved profile area and request delivery location are clearly labeled
  separately; legacy/noncanonical saved areas are shown as "Needs
  update" and are not prefilled as the request village.
- Review screen title changed from "Confirm request" to "Review request"
  and is now laid out in grouped sections.
- Attestation is now a full-width block above the final action buttons;
  buttons are equal-width on desktop and stacked on mobile.

Resident profile / delivery information reminder:
- Noncanonical saved villages (e.g., `Lower Hells Gate`) now force a
  mandatory profile review. The reminder modal shows the old value as
  "Needs update" and does not offer "Everything Is Correct."
- `confirmDeliveryProfile()` now refuses confirmation when the village
  is not one of the five canonical choices.
- Phone numbers in the reminder modal are formatted for display only;
  the stored canonical value is unchanged.
- Fixed the village dropdown reset bug: the select now stays on the
  saved value after a successful profile save.
- Modal action buttons are now a mobile-first stacked layout and a
  two-column equal-width layout on larger screens.

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

# Driver Guide

A simple guide for water delivery drivers using the Driver portal.

## Logging in

Sign in at `/login` with your account. If your account is linked to a
Driver Registry entry, you will see the driver portal.

## Adding the Driver App to your phone

The application is live as a pilot at
`https://saba-water-delivery.vercel.app`. Scan the official **Driver App** QR
code or open `/driver/install` on that site.

- On Android/Chrome, tap **Install Driver** when the button appears and approve
  the browser prompt.
- On iPhone or iPad, open the page in Safari, tap **Share**, choose **Add to Home
  Screen**, and tap **Add**. If you opened the code in another iOS browser, open
  it in Safari first.
- If the app is already running from your home screen, it opens the Driver
  portal instead of repeatedly showing installation instructions.

The home-screen app uses your existing account. Installing it does not create a
second account. Login, logout, and switching to another authorized role work the
same as in the normal browser. The app needs a connection for current
deliveries, delivery information, and updates; if cellular service drops, wait
for the offline notice to clear before continuing.

## Going online

Use the online/offline switch to let the system know you are ready to
receive a delivery. **Only go online when you are actually ready to take a
delivery** — while you are online, the next delivery may be assigned to you
immediately when you open or refresh the portal. You can go offline at any
time — this never affects your standing with government, it just means you
will not receive new delivery assignments while offline.

If government has restricted your delivery access, you will not be
able to go online. Contact the Water Delivery Office if you believe
this is a mistake.

## Assigned deliveries — one at a time

While you are online and eligible, the system assigns you **one** delivery
at a time — you will not see a list of every open request. This keeps
access to work fair for every driver, since it prevents drivers from
picking only the easiest or closest jobs.

The delivery shown under **Assigned Deliveries** is already assigned to
you the moment it appears. **You do not need to accept anything** — there
is no Accept button. **Closing the app or putting your phone away does NOT
release it** — the delivery stays yours until you complete it, release it,
or the office reassigns it.

Each assigned delivery shows the customer's name, village, quantity (for
example, "2 loads (2,000 gallons)"), how long the request has been waiting,
and the delivery directions. If the request includes **Notes / Comments**, they
appear as supplementary information below the directions. Review them for
request-specific access or timing details, but continue to rely on the
structured location, quantity, priority, and collection requirements.

## Decline / Release a delivery

If you cannot or will not make an assigned delivery, press
**Decline / Release Delivery** and confirm. The delivery is returned to
dispatch so another driver can take it, and you will not lose your place
for future deliveries.

There is a limit on how many deliveries you can release in one day before
new assignments pause for you for a while (both the daily limit and the
pause length are set by government administrators). This does not
affect your eligibility to deliver — it only pauses new assignments
temporarily.

After you release:

- If you are still under the limit, you will see
  **"Delivery released. It has been returned to dispatch for another driver."**
- If you reach the configured decline limit, the app will tell you exactly
  what is happening:
  - **"You have reached the decline limit. You are offline until 3:42 PM."**
    (the time uses the configured cooldown length and Saba local time).
  - **"You have reached today's decline limit and are offline for the rest of
    the day. You can receive deliveries again on the Saba-local date shown."**
    (when the cooldown would run past the end of today; the exact date comes
    from the configured cooldown hours).

While a cooldown is active, your dashboard shows **"Offline until ..."** or
**"Offline for the rest of today"** and the online/offline switch is hidden.
If you try to go online while the cooldown is still active, the app will
prevent it and tell you exactly when you can receive deliveries again.

You cannot release a delivery once you have recorded water collection for
it — at that point contact the Water Delivery Office. Deliveries that are
part of a delivery run are also managed by the office and cannot be
released from the app.

## Recording Water Collection

Before you mark a delivery as delivered, you must record water collection for each physical load:

- For each load, select the fill station. **The Bottom** is selected by default.
- The system shows the meter assigned to you for that station. If no meter is assigned, contact the Water Delivery Office.
- Press **Water collected** for each load. One-load requests need one collection; two-load requests need two collections.
- You can only mark the delivery as delivered after all loads are recorded.

## Completing a delivery

Your assigned delivery shows the customer's contact and location
information. After you deliver the water, use **Mark
Delivered** to close out your part of the job. If the request is for 2
loads (2,000 gallons), mark it delivered only after the full quantity
has been physically delivered.

## When your next request becomes available

The moment you mark a delivery complete, you are free to receive
another assignment. The resident's later confirmation is separate and does
not hold you up — you do not need to wait for them to confirm they
received the water before you can be assigned your next delivery.

You may only hold one active delivery at a time. If you already have a
delivery in progress, you will not be assigned another one until you
mark the current one delivered. Marking it delivered also asks an eligible
registered resident by email to review receipt. That email is separate from
your completion action: a send failure does not keep the delivery assigned to
you or delay your next assignment.

If the system shows you have an active delivery but you do not
recognize it (for example, from old testing data), simply load the
Driver portal — the system will automatically detect and clear the
outdated reference so you can receive new assignments normally.

## Going offline

You can go offline whenever you are done for the day, or any time in
between deliveries. Going offline does NOT release a delivery that is
already assigned to you — it only means you will not receive new
delivery assignments until you go back online.

## Delivery runs

Occasionally, government staff may assign you several deliveries at
once instead of one at a time — you will see each one listed under
"Assigned Deliveries" with a "Delivery run" label. This is a deliberate
staff decision, usually because you were preparing for a day with
unreliable phone or data access, and it does not change how you complete
each delivery — mark each one delivered individually, exactly as you would
any other delivery. Delivery-run deliveries cannot be released from the
app — contact the Water Delivery Office if you cannot complete one. You
will not receive new normal assignments until your delivery run is
completed.

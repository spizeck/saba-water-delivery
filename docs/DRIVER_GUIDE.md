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
same as in the normal browser. The app needs a connection for current offers,
delivery information, and updates; if cellular service drops, wait for the
offline notice to clear before continuing.

## Going online

Use the online/offline switch to let the system know you are ready to
receive deliveries. You can go offline at any time — this never
affects your standing with government, it just means you will not be
offered new deliveries while offline.

If government has restricted your delivery access, you will not be
able to go online. Contact the Water Delivery Office if you believe
this is a mistake.

## Receiving one delivery at a time

While you are online and eligible, you will be offered **one** delivery
at a time — you will not see a list of every open request. This keeps
access to work fair for every driver, since it prevents drivers from
picking only the easiest or closest jobs.

Each offer shows the customer's name, village, quantity (for example,
"2 loads (2,000 gallons)"), how long the request has been waiting,
and the delivery directions.

## Accept or Decline

- **Accept Delivery** claims the request for you. Once claimed, no
  other driver can take it.
- **Decline** passes on this offer. It stays available for another
  driver, and you will not lose your place for future offers.

There is a limit on how many offers you can decline in one day before
new offers pause for you for a while (both the daily limit and the
pause length are set by government administrators). This does not
affect your eligibility to deliver — it only pauses new offers
temporarily.

After you decline:

- If you are still under the limit, you will see
  **"Load declined. Another offer will appear when available."**
- If you reach the configured decline limit, the app will tell you exactly
  what is happening:
  - **"You have reached the decline limit. You are offline until 3:42 PM."**
    (the time uses the configured cooldown length and Saba local time).
  - **"You have reached today's decline limit and are offline for the rest of
    the day. You can receive offers again on the Saba-local date shown."**
    (when the cooldown would run past the end of today; the exact date comes
    from the configured cooldown hours).

While a cooldown is active, your dashboard shows **"Offline until ..."** or
**"Offline for the rest of today"** and the online/offline switch is hidden.
If you try to go online while the cooldown is still active, the app will
prevent it and tell you exactly when you can receive offers again.

## Recording Water Collection

Before you mark a delivery as delivered, you must record water collection for each physical load:

- For each load, select the fill station. **The Bottom** is selected by default.
- The system shows the meter assigned to you for that station. If no meter is assigned, contact the Water Delivery Office.
- Press **Water collected** for each load. One-load requests need one collection; two-load requests need two collections.
- You can only mark the delivery as delivered after all loads are recorded.

## Completing a delivery

Once you accept a delivery, you can view the customer's contact and
location information. After you deliver the water, use **Mark
Delivered** to close out your part of the job. If the request is for 2
loads (2,000 gallons), mark it delivered only after the full quantity
has been physically delivered.

## When your next request becomes available

The moment you mark a delivery complete, you are free to receive
another offer. The resident's later confirmation is separate and does
not hold you up — you do not need to wait for them to confirm they
received the water before you can be offered your next delivery.

You may only hold one active delivery at a time. If you already have a
delivery in progress, you will not be offered another one until you
mark the current one delivered.

If the system shows you have an active delivery but you do not
recognize it (for example, from old testing data), simply load the
Driver portal — the system will automatically detect and clear the
outdated reference so you can receive new offers normally.

## Going offline

You can go offline whenever you are done for the day, or any time in
between deliveries. Going offline simply means you will not be offered
new deliveries until you go back online.

## Delivery runs

Occasionally, government staff may assign you several deliveries at
once instead of one at a time — you will see each one listed under "My
deliveries" with a "Delivery run" label. This is a deliberate staff
decision, usually because you were preparing for a day with unreliable
phone or data access, and it does not change how you complete each
delivery — mark each one delivered individually, exactly as you would
any other delivery. You will not be offered new normal deliveries
until your delivery run is completed.

# Saba Water Delivery

Government RO water delivery request and driver dispatch system for Saba.

This system replaces the current process where residents contact individual
water delivery drivers directly. Residents request a standard 1,000-gallon
load, eligible drivers claim and deliver it, and government staff retain
full operational visibility.

See the source-of-truth project documents:

- [`PRODUCT.md`](./PRODUCT.md) — product requirements and business logic
- [`TECHNICAL.md`](./TECHNICAL.md) — architecture and data model guide
- [`DEVIN.md`](./DEVIN.md) — development guide and implementation sequence

## Implementation status

This repository currently contains the **application foundation plus the
authenticated user and resident profile foundation** — not the full V1
workflow. What exists today:

- Next.js App Router project (TypeScript, Tailwind CSS v4), Vercel-ready.
- Application shell: public home page, `/login`, and portal pages for
  `/resident`, `/driver`, `/dispatcher`, and `/admin`.
- Working sign-in at `/login` via Firebase Authentication (Google,
  Facebook, email/password), backed by an httpOnly session cookie
  (`/api/auth/session`) verified server-side on every request with the
  Firebase Admin SDK — the browser is never trusted to assert its own
  identity or role.
- On first sign-in, a Firestore `users/{uid}` document is created with
  role defaulted to `resident` (`src/lib/domain/users.ts`); existing
  users' roles and saved profile data are never overwritten on
  re-authentication.
- Server-side route protection (`src/lib/auth/session.ts`'s
  `requireRole`): `/resident`, `/driver`, `/dispatcher`, and `/admin` each
  redirect unauthenticated visitors to `/login` and wrong-role visitors to
  `/access-denied`. This is enforced on the server, not just by hiding
  navigation.
- Resident profile workflow at `/resident`: view/edit display name, phone,
  village/area, and delivery directions (email shown read-only) via a
  Server Action, plus a first-login prompt to complete the profile before
  water requests are available.
- Firebase client SDK (`src/lib/firebase/client.ts`) and Admin SDK
  (`src/lib/firebase/admin.ts`) configuration, both degrading gracefully
  (clear "not configured" states) when env vars are absent.
- Domain types (`src/lib/domain/types.ts`) mirroring the Firestore schema
  in `TECHNICAL.md`, centralized business configuration
  (`src/lib/domain/config.ts`), and signature-level stubs for the water
  request domain operations (`createWaterRequest`, `claimWaterRequest`,
  etc.) that will be implemented next.
- `firestore.rules` (deny-by-default, role-aware, prevents self-elevation
  of role) and `firebase.json`.

**Not yet implemented:** the water request workflow (create/claim/deliver/
confirm), driver/dispatcher/admin dashboards beyond placeholders,
statistics, and any staff-facing role management UI (role changes
currently require editing Firestore directly). See `DEVIN.md` for the
intended build order.

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Other useful commands:

```bash
npm run lint    # ESLint
npm run build   # Production build (also runs the TypeScript compiler)
npm run start   # Serve the production build
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Never commit
`.env.local` or any file containing real secrets.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client SDK config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase client SDK config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase client SDK config |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase client SDK config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase client SDK config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase client SDK config |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin SDK (server-only) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Firebase Admin SDK (server-only) |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Firebase Admin SDK (server-only) |

The Firebase client variables come from **Firebase Console → Project
settings → General → Your apps → Web app**. The Admin SDK variables come
from a service account key generated at **Firebase Console → Project
settings → Service accounts → Generate new private key**.

Without these variables set, the app still builds and runs — the login
page shows a clear "not configured" notice instead of failing.

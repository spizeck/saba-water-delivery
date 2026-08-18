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

This repository currently contains the **initial application foundation**
only — not the full V1 workflow. What exists today:

- Next.js App Router project (TypeScript, Tailwind CSS v4), Vercel-ready.
- Application shell: public home page, `/login`, and placeholder portal
  pages for `/resident`, `/driver`, `/dispatcher`, and `/admin`.
- Firebase client SDK configuration (`src/lib/firebase/client.ts`) and a
  working `/login` page wired to Google, Facebook, and email/password
  sign-in via Firebase Authentication (degrades to a clear "not
  configured" message if Firebase env vars are absent).
- Firebase Admin SDK configuration (`src/lib/firebase/admin.ts`) for
  future trusted server-side operations.
- Domain types (`src/lib/domain/types.ts`) mirroring the Firestore schema
  in `TECHNICAL.md`, centralized business configuration
  (`src/lib/domain/config.ts`), and signature-level stubs for the core
  domain operations (`createWaterRequest`, `claimWaterRequest`, etc.) that
  will be implemented next.
- A starter `firestore.rules` (deny-by-default, role-aware) and
  `firebase.json` for when a Firebase project is connected.

**Not yet implemented:** the resident request workflow, driver queue and
claiming, delivery confirmation, dispatcher/admin dashboards, statistics,
and user role storage/enforcement. See `DEVIN.md` for the intended build
order.

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

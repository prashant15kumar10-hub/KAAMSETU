# KAAMSETU — Backend (for the existing static frontend)

The backend for the `kaamsetu-frontend` (now connected to it; see `docs/FRONTEND_INTEGRATION.md`). **Zero npm dependencies** — it uses only Node 22 built-ins
(`http`, `crypto`, `node:sqlite`), so there is nothing to install and no supply-chain surface.

> Requires **Node.js 22.13 or newer**. `node:sqlite` is marked experimental by Node; it prints a warning, which the npm scripts silence.

## Run it

```bash
cd kaamsetu-backend
npm test                 # API + operations tests against a real HTTP server (in-memory/temp DBs)
npm run seed             # OPTIONAL dev demo data (refuses to run in production or on a non-empty DB)
STATIC_DIR=../kaamsetu-frontend npm start   # serves API + your frontend on http://127.0.0.1:3000
```

Without `STATIC_DIR`, run the frontend separately (`python3 -m http.server 8080` in the frontend folder);
`http://localhost:8080` and `http://127.0.0.1:8080` are allowed by CORS by default (`ALLOWED_ORIGINS` to change).

Dev logins after `npm run seed` (password `Demo@12345`): `suresh@example.com` (contractor); workers `9000000001`, `9000000002`, `9000000003`.

Create an admin (admins can **never** self-register):
```bash
ADMIN_IDENTIFIER=you@example.com ADMIN_PASSWORD='at-least-12-chars' npm run create-admin
```

Backup / restore: `npm run backup` writes a **verified** snapshot to `data/backups/` and prunes old ones; `npm run restore -- <file> --yes` (server stopped) restores it and keeps the previous database. `npm run test-alert` checks your alert webhook. See `docs/OPERATIONS.md`.
The app never drops or resets the database; schema changes are append-only migrations (`src/db.js`).

## What is here

| Area | What the backend does |
|---|---|
| Accounts | Register/login (phone or email + password, scrypt), production email/SMS identifier verification via configured HTTPS delivery adapter, opaque revocable bearer sessions (default 7 days), password change signs out other devices, login/register rate limits |
| Admin security | Production TOTP MFA required by default; first login enrolls an authenticator app; subsequent logins require a code |
| Roles | `worker` / `contractor` / `admin`, **enforced on the server** on every route. The "I am looking for work / I want to hire" choice is navigation only and grants nothing |
| Language | Hindi + English. Preference stored per account; every error has a **stable code** plus a localized message (`?lang=`, `X-Language`, user preference, `Accept-Language`). `GET /api/messages` returns the catalog |
| Jobs | Drafts, guided publish with required review confirmation, full terms (hours, equipment, pay timing, cancellation), staffing counts (needed / confirmed / cancelled / arrival pending / arrived) |
| Repeat job | Copies **details only** into a new draft; date cleared; no workers/attendance/payments copied; must be re-reviewed before publishing |
| Booking | Worker must explicitly accept the **current terms version**; capacity and duplicates enforced in a DB transaction + unique constraint; editing terms moves booked workers to "needs re-acceptance" |
| Attendance | Contractor-recorded vs worker self-reported — both labelled **unverified**; confirmation ≠ guaranteed attendance |
| Payments | Agreed wage, recorded work, owed, contractor-reported, worker-acknowledged, disputed are kept **separate**; worker can dispute; contractor can respond or correct; corrections supersede (never overwrite); full event history |
| Help | Ordinary help requests, clearly labelled **not confidential**; admin triage |
| Admin | View users (enable/disable), help queue, disputed payments, audit log. Admins cannot edit payments, bookings or job terms |
| Reliability | `Idempotency-Key` header replays retried POSTs (double-tap / flaky network safe), `Cache-Control: no-store`, body size limit, input validation |

## What is deliberately NOT here (see `docs/FEATURE_MATRIX.md`, `docs/POLICY_SPECS.md`)

2+1 fair selection, advances accounting, cancellation/travel compensation, confidential safety reporting, replacement
assistance, verified skills, GPS attendance, SMS/WhatsApp/push notifications beyond the configured verification adapter, and any real money movement (escrow, refunds, transfers).
These need policy approval, an external provider, or legal review, and **`GET /api/capabilities` says so honestly**.
Cancelling a booking/job returns `compensation: { calculated: false }` — nothing invented.

## Production
Production requires `REQUIRE_IDENTIFIER_VERIFICATION=true`, `REQUIRE_ADMIN_MFA=true`, and an HTTPS delivery adapter configured through `VERIFICATION_DELIVERY_URL`, `VERIFICATION_DELIVERY_TOKEN`, a 32+ character `VERIFICATION_CODE_SECRET`, and a separate 32+ character `MFA_ENCRYPTION_KEY`. See `docs/DEPLOYMENT.md` and root `SECURITY_IMPLEMENTATION_AND_TEST_PLAN.md`. Run `npm run production-check` with the production environment loaded before launch.

`docs/DEPLOYMENT.md` (Docker+Caddy or systemd+nginx), `docs/OPERATIONS.md` (logs, alerts, uptime, backups, recovery). Deployment files are in `../deploy/`.

## Other docs
- `docs/API.md` — endpoint reference
- `docs/FEATURE_MATRIX.md` — what is implemented/tested vs. missing vs. needs a decision
- `docs/POLICY_SPECS.md` — draft specs to approve before building the sensitive features
- `docs/FRONTEND_INTEGRATION.md` — how each `localStorage` call in the frontend maps to an endpoint, plus issues found
- `client/kaamsetu-api.js` — optional small fetch wrapper you can add to the frontend yourself

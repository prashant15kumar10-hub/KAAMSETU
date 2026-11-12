# KAAMSETU — combined source package (frontend + backend + deployment)

This package combines the existing frontend and backend and includes a security-hardened candidate plus deployment examples. It is **not production-certified** and does not implement every item in the broader product brief. See `REPORT.md` and `kaamsetu-backend/docs/FEATURE_STATUS.md` for verified status and gaps:

```
kaamsetu-frontend/   static site, now connected to the API (login/register + all screens)
kaamsetu-backend/    API (Node 22, zero npm dependencies, SQLite) + tests + ops scripts + docs
deploy/              Dockerfile, docker-compose, Caddyfile (auto-HTTPS), systemd unit, nginx sample, production env example
e2e/run_e2e.py       real-browser (Chromium) end-to-end test
REPORT.md            what was done, test results, what still needs you
```

## Run it locally (2 minutes)
Needs Node.js **22.13 or newer**. Nothing to install.
```bash
cd kaamsetu-backend
npm test                                              # backend tests
STATIC_DIR=../kaamsetu-frontend npm start             # site + API on http://127.0.0.1:3000
# optional demo data (dev only):  npm run seed        (logins in kaamsetu-backend/README.md)
# optional first administrator:   ADMIN_IDENTIFIER=you@example.com ADMIN_PASSWORD='12+ characters' npm run create-admin
```
Browser test (optional): `pip install playwright && playwright install chromium && python3 e2e/run_e2e.py`

## Put it online
See `kaamsetu-backend/docs/DEPLOYMENT.md` (Docker + Caddy is the shortest route) and `kaamsetu-backend/docs/OPERATIONS.md`
(logs, alerts, uptime monitoring, backups, restore runbook). **Read REPORT.md first**: it lists what is verified, what is not, and what only you can supply.

## Environment variables
`kaamsetu-backend/.env.example` (all options) and `deploy/.env.production.example` (production). No real secrets are included anywhere.
Database migrations run automatically at start and are append-only (the database is never dropped or reset).


## Visual Studio Code (Windows)

See [`RUN_IN_VSCODE.md`](RUN_IN_VSCODE.md) for step-by-step setup, start commands, local endpoint checks, and troubleshooting.


## Security hardening build
See `SECURITY_REVIEW.md`, `SECURITY_IMPLEMENTATION_AND_TEST_PLAN.md`, and `VALIDATION_RESULTS.txt`. Production requires an HTTPS email/SMS delivery adapter plus `VERIFICATION_DELIVERY_TOKEN`, `VERIFICATION_CODE_SECRET`, and a separate `MFA_ENCRYPTION_KEY`. Do not leave example values in `deploy/.env.production.example`; replace them with unique secrets from a secret manager. Run `npm run production-check` inside the backend with the production environment loaded. This build has not undergone an independent penetration test and is not production-certified.

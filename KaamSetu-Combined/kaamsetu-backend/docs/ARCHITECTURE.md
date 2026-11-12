# KAAMSETU architecture (verified source overview)

## Runtime and boundaries

- **Runtime:** Node.js 22.13+; CommonJS; Node's built-in HTTP server and `node:sqlite`; no declared runtime npm dependencies.
- **Frontend:** static HTML, CSS and JavaScript in `kaamsetu-frontend/`; served by the backend when `STATIC_DIR` is configured.
- **API:** `kaamsetu-backend/src/app.js` registers route modules (`meta`, `auth`, `jobs`, `bookings`, `payments`, `help`, `admin`). `src/http.js` applies parsing, routing, authentication, security headers, error handling and static-file serving.
- **Database:** SQLite, additive/versioned migrations in `src/db.js`; foreign keys enabled, WAL mode for file databases, busy timeout configured. Migrations are not destructive.
- **Deployment examples:** `deploy/` includes Docker/Caddy, nginx, systemd and environment examples. These examples have not been validated on a real production host.

## Main data relationships

- `users` owns authenticated identities and roles (`worker`, `contractor`, `admin`).
- `sessions` stores hashed session-token identifiers and expiry/revocation state.
- `jobs` belongs to a contractor. `bookings` links a worker to a job and snapshots the accepted terms version.
- `booking_events` preserves booking history; `attendance` distinguishes contractor-recorded attendance from worker self-report.
- `payments` are payment **reports**, not payment-provider transactions. `payment_events` preserves acknowledgement, dispute and correction history.
- `help_requests` stores ordinary, non-confidential support requests. Safety complaints are explicitly not enabled.
- `audit_log` records security-relevant actions; `idempotency` prevents duplicate operations on supported requests.
- Migration 3 adds verification-code and administrator-MFA state (`verification_codes`, `auth_challenges`, MFA fields on `users`).

## Security boundaries

- Passwords use Node `scrypt`; bearer session tokens are stored hashed and can be revoked.
- Protected routes use server-side roles and ownership/participant checks. Sensitive API routes should return non-disclosing not-found responses where appropriate.
- SQL access uses prepared statements/parameters in reviewed routes. Request bodies are capped, HTTP timeouts are set, errors are generic, and logs avoid credentials.
- CSP disallows inline JavaScript event attributes (`script-src-attr 'none'`). Frontend actions use a literal-only dispatcher. Inline style attributes remain permitted by policy.
- Production config requires identifier verification and administrator MFA by default, with provider configuration and strong distinct secrets. The verification adapter is a generic HTTPS contract; a real provider still must be configured and tested.
- The app is not its own TLS terminator. Production should bind privately behind a trusted HTTPS reverse proxy. Set `TRUST_PROXY=true` only when the proxy is trusted and correctly configured.

## Deliberate integration boundaries

No actual money moves through KAAMSETU. There is no UPI/bank payout, escrow, SMS/WhatsApp provider account, live email provider, continuous location tracking, independent attendance verification, or independent penetration-test result bundled with this repository. Do not imply these are active.

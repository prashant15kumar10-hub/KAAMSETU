# KAAMSETU Security Review — Code-Level Review

**Scope:** `kaamsetu-backend/`, `kaamsetu-frontend/`, and the included Docker/Caddy/Nginx/systemd deployment examples in this ZIP.

**Review type:** Static code/configuration review plus automated regression tests and local HTTP checks. This is **not** a full penetration test, an independent third-party audit, or verification of a live production deployment.

## Executive summary

One concrete authentication-abuse weakness was found and fixed: login throttling was keyed only by IP **and** submitted identifier, so changing the identifier could bypass the per-key limit. The in-memory limiter also had no hard maximum on its number of keys. The fix adds a separate IP-wide login bucket and caps the in-memory limiter map. Regression tests cover both behaviors.

The existing code already contains meaningful controls: server-side role checks, participant/owner checks for jobs/bookings/payments, parameterized SQLite statements, scrypt password hashing, hashed bearer-session tokens, session revocation, request body limits, several security headers, origin allowlisting, generic client errors, and automated authorization/privacy tests. These controls reduce risk but do not prove the whole application is secure.

## Finding SEC-001 — Login rate-limit bypass and unbounded limiter keys

- **Severity:** Medium
- **Confidence:** High; confirmed by code inspection and regression test
- **Affected files:** `kaamsetu-backend/src/routes/auth.js`, `src/security.js`, `src/config.js`
- **Root cause:** Login throttling previously used `login:<IP>:<normalized identifier>` only. A caller could submit a different valid-format email/phone on each attempt and receive a fresh bucket each time. Unknown-user attempts also perform a synchronous password-hash verification, so varying identifiers could drive expensive CPU work. The limiter Map did not enforce a hard maximum number of keys.
- **Impact:** Increased risk of login-endpoint CPU exhaustion and memory growth; per-identifier throttling alone was not an effective per-IP abuse limit.
- **Fix implemented:** Added an IP-wide login bucket (`loginIpMax`, default 50 per 15-minute window) in addition to the existing per-IP/per-identifier bucket (10 per 15 minutes by default). Added a configurable hard cap for limiter entries (default 10,000), periodic expiry cleanup, and bounded eviction when the map is full.
- **Regression tests:** New test confirms changing identifiers from the same IP hits the IP-wide limit; new unit test confirms the limiter map stays within its configured cap.
- **Residual risk:** The limiter is in-process. Limits reset on restart and are not shared between multiple application replicas. A multi-instance deployment should use a shared rate-limit store or enforce limits at a trusted edge proxy/WAF.

## Existing controls observed

- Passwords are hashed with Node's `scrypt`; raw session tokens are not stored in the sessions table.
- SQL queries use prepared statements/parameters in the reviewed routes.
- Registration rejects self-assigned admin roles; admin creation is a CLI operation.
- Routes enforce account roles, and sensitive booking/payment routes check participant or ownership relationships.
- Request bodies have a 64 KiB limit; Node HTTP timeouts are configured.
- API responses use `Cache-Control: no-store`; CORS origins are allowlisted; security headers include CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.
- Error responses are generic; structured logging avoids request bodies, passwords, and authorization headers.
- No third-party runtime dependencies are declared in `kaamsetu-backend/package.json`.
- Static frontend review found dynamic user-entered/job/payment/help text generally passed through HTML escaping. This was a code inspection, not a browser-based XSS penetration test.

## Security improvements added after the initial review

1. **Email/phone verification workflow:** production requires identifier verification before issuing sessions. Six-digit codes expire after 10 minutes, are stored as hashes, and are limited by expiry/attempt/rate controls. Delivery requires a configured HTTPS adapter; no vendor account or credentials are bundled.
2. **Administrator MFA:** production requires TOTP enrollment on first admin login and a TOTP code on later logins. TOTP secrets are encrypted at rest with AES-256-GCM using `MFA_ENCRYPTION_KEY`. Challenges expire, are attempt-limited, and do not create sessions before successful verification.
3. **Stricter CSP:** inline event handlers were replaced with `data-action` attributes and a literal-only dispatcher; CSP now sets `script-src-attr 'none'`. Inline style attributes remain allowed for the existing UI.
4. **Database file protection:** the app sets SQLite database/WAL/SHM files to owner-only permissions on POSIX systems where possible. Backup directories and backup/restore files are also restricted to owner access.
5. **Production preflight:** `npm run production-check` checks required flags, delivery configuration, CORS, binding assumptions, static files, and local database permissions. It cannot inspect remote infrastructure.

## Important gaps / residual risks (not represented as confirmed exploitable vulnerabilities)

1. **External delivery adapter still must be configured and tested:** this ZIP includes a generic HTTPS webhook contract, not an email/SMS vendor account. Production startup now fails closed when the required delivery URL/token and 32+ character verification/encryption secrets are absent or placeholders. Do not deploy until the adapter reliably sends email and SMS and you have tested both channels.
2. **No real-money integration:** payment records are statements, not verified transfers; the application does not process or refund money. Payment-provider/webhook security cannot be tested because no provider is integrated.
3. **CSP residual trade-off:** inline JavaScript event handlers are blocked. `style-src 'unsafe-inline'` remains because the existing UI uses inline style attributes; consider moving those styles to CSS as a separate hardening task.
4. **Session token storage:** the frontend keeps its bearer token in `sessionStorage`. This avoids persistent local storage but any successful same-origin script injection could still read it. Keep XSS prevention and dependency/change review as priorities.
5. **Admin MFA recovery:** there are no user-facing backup codes. Establish a secure, documented out-of-band recovery process before production, and keep authenticator secrets protected.
6. **Deployment remains unverified:** the actual target host was not available. HTTPS/TLS, DNS, reverse-proxy behavior, secret-manager access, firewall exposure, and backup restoration still require live deployment checks.
7. **Supply-chain/runtime environment:** the Docker base images use moving tags (`node:22-bookworm-slim`, `caddy:2`) rather than immutable digests. Pin and regularly update images in a production release process.
8. **Backups:** scheduled backups are configured in the compose example, but the same-volume backup is not an off-site disaster-recovery copy. Configure encrypted off-site backups and test restoration.

## Validation performed

- `node --no-warnings --test test/*.test.js`: **59 tests passed, 0 failed** after these changes.
- New tests cover identity verification with a mock delivery adapter, TOTP admin enrollment/login, CSP event-handler removal, and safe literal action dispatch.
- Changed JavaScript files passed Node syntax checks; `npm run production-check` passed against a configured test environment (database did not exist yet, so its file permissions remain a post-start check).
- ZIP archive integrity check passed.
- A browser-based smoke test was attempted but the execution environment blocked Chromium navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`); therefore, a full browser user journey is **not verified**.
- No live external host was scanned or attacked. No production TLS scan, cloud/IAM review, or independent penetration test was performed.

## Release recommendation

This ZIP includes code-level hardening for identifier verification, administrator MFA, CSP event-handler blocking, and local database file permissions. It remains **security-reviewed with limited scope**, not “fully secure,” “penetration-tested,” or production-certified. Before real users or sensitive financial data are involved, configure and test the delivery adapter, verify the live deployment, pin deployment images, configure encrypted off-site backups, and obtain an independent authorized penetration test.

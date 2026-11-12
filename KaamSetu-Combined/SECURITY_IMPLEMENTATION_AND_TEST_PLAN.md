# KAAMSETU security implementation and remaining verification

## Implemented in this build

### Email/phone identity verification
- Production defaults `REQUIRE_IDENTIFIER_VERIFICATION=true`; unverified accounts do not receive a session.
- A six-digit, 10-minute verification code is delivered by the configured HTTPS adapter. Codes are stored as hashes, expire, and allow at most five attempts.
- Verification delivery is rate-limited. A provider delivery failure fails closed and the newly registered account is removed rather than left in a misleading half-registered state.
- The adapter must send email when `channel=email` and SMS when `channel=phone`. It receives `POST` JSON `{to, channel, code, purpose, expires_in_seconds}` with `Authorization: Bearer <VERIFICATION_DELIVERY_TOKEN>` and must return a 2xx only when it accepts the delivery.
- This project does not itself contain SMTP/SMS vendor credentials or an account with a delivery provider. Configure and test your own adapter before production startup.

### Administrator MFA
- Production defaults `REQUIRE_ADMIN_MFA=true`.
- Admin password login alone never creates a session: first login requires TOTP enrollment; subsequent logins require a valid 6-digit authenticator code.
- MFA challenges expire after 10 minutes, are single-use on success, and cap failed attempts.
- The TOTP secret is encrypted at rest with AES-256-GCM using `MFA_ENCRYPTION_KEY`, and shown during enrollment only. Store it in an authenticator app; it is not a recovery code. Keep the encryption key in a secret manager, back it up securely, and establish an offline administrator recovery procedure before launch. Rotating this key requires a planned migration/re-encryption of stored TOTP secrets; do not rotate it casually.

### Content Security Policy
- Removed inline `onclick` attributes from the frontend and replaced them with `data-action` plus a strict literal-only event dispatcher (no `eval` or `Function`).
- CSP now includes `script-src-attr 'none'`. `style-src 'unsafe-inline'` remains because the existing interface uses inline style attributes; this is separate from allowing inline JavaScript handlers.

### Production checks
- `npm run production-check` validates required production flags, delivery-adapter settings, CORS, host binding, frontend path, and database file permissions where POSIX permissions are available.
- The script explicitly cannot verify a remote host's DNS, live TLS certificate/renewal, firewall/security groups, secret-manager ACLs, patching, or backup restore. Those checks require access to the chosen hosting account and server.

## Tests run for this build
- Existing backend test suite plus new identity-verification and administrator-MFA tests.
- Syntax checks for changed backend and frontend JavaScript.
- Static check that the frontend no longer contains inline `onclick`, `onchange`, or `onsubmit` attributes.
- ZIP integrity check after packaging.

## Independent penetration test — NOT COMPLETED
This repository change is not an independent penetration test and cannot certify that the service is safe against attackers. Before public launch, engage an authorized tester against a staging deployment and obtain a written report. Scope should include:

1. Account enumeration, password spraying, OTP brute force/resend abuse, verification expiry/replay, and MFA enrollment/challenge abuse.
2. Broken access control/IDOR across users, jobs, bookings, attendance, help requests, admin endpoints, and payment reports.
3. Injection, stored/reflected XSS, CSP bypass, CSRF assumptions, CORS, malformed input, path traversal, and unsafe redirects.
4. Session theft/revocation/expiry, password changes, disabled accounts, admin privilege escalation, and audit-log leakage.
5. Rate-limit bypasses across multiple IPs/processes, resource exhaustion, dependency and Node runtime risks.
6. Production TLS, reverse-proxy headers, secrets exposure, SQLite file permissions, backup access, restore integrity, and firewall reachability.

Only test systems you own or have explicit written permission to test. Do not run destructive or denial-of-service tests on production.

# Security policy and controls

## Scope

This repository is a Node.js/SQLite pilot application. This document describes observed code controls and known limitations; it is not a certification, warranty, or claim that the application is secure against every attack.

## Current controls observed and tested

- `scrypt` password hashing; hashed revocable bearer-session tokens.
- Server-side role and resource ownership/participant checks.
- Parameterized SQLite statements in reviewed route code.
- Server-side input validation, bounded request bodies, HTTP timeouts and generic error responses.
- Login rate limiting per identifier and per IP, registration throttling and a bounded in-memory limiter map.
- Security headers including CSP with `script-src-attr 'none'`, cache controls, origin allowlist, and HSTS when configured.
- Request IDs, structured logs designed to avoid credentials, audit records, idempotency and additive database migrations.
- Production identifier-verification and administrator TOTP MFA workflows, both of which require operational configuration before use.
- Local backup/restore validation and POSIX owner-only permissions where supported.

## Known limitations

- No independent penetration test or third-party code audit has been completed.
- Rate limits are in-process and reset on restart; multi-replica deployments need a shared limiter or trusted edge controls.
- Identifier verification needs a real HTTPS email/SMS delivery adapter and live delivery tests.
- Admin MFA recovery/backup-code operations need a secure out-of-band process.
- Bearer tokens are held in frontend `sessionStorage`; a successful same-origin script injection could read them.
- Inline style attributes remain allowed by CSP. The app must still be reviewed for XSS and accessibility.
- Public deployment TLS/DNS/firewall/secret manager/host patching and backup restoration have not been verified.
- No real payment, SMS/WhatsApp, emergency relay, or provider-signed callback integration is active.
- Local backups on the same volume are not disaster recovery; configure encrypted off-site backups and test restoration.

## Before production

1. Configure actual distinct secrets using a secret manager; never commit `.env` files.
2. Configure and test the real HTTPS identity-delivery adapter.
3. Ensure administrators enroll TOTP and document secure recovery.
4. Run `npm run production-check` against the actual environment.
5. Deploy behind a trusted HTTPS reverse proxy; verify TLS renewal, CORS, firewall and trusted proxy configuration.
6. Configure encrypted off-site backups, run a restore drill, and set log/audit retention.
7. Run dependency/source scanning and an independent authorized penetration test; resolve findings before onboarding real users at scale.
8. Verify legal/privacy obligations and consent/retention policies with qualified reviewers.

## Reporting

Do not publish exploit details or real credentials in public issue trackers. Report suspected vulnerabilities privately to the project owner/operator with affected version, reproduction steps and impact. No dedicated security-reporting address is configured in this repository; establish one before public deployment.

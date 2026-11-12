# Feature status — source and tests, not aspirations

Status is based on the checked-in source and the validation run documented in `docs/TEST_REPORT.md`. It does not imply production deployment or real-world validation.

## Implemented in the application

- Worker/contractor accounts, password hashing, sessions, logout/revocation and password change.
- Role-based authorization, job drafts/publishing, job discovery, job acceptance with explicit current-terms acceptance, capacity and duplicate protection, repeat-as-new-draft.
- Booking lifecycle, cancellation records, event history and idempotency for supported operations.
- Contractor-recorded attendance and worker self-reported arrival, explicitly marked unverified.
- Payment reports, worker acknowledgement, disputes, contractor response/correction history; reported payment is not treated as bank proof.
- Ordinary help requests and admin triage; API capability responses describe unavailable features.
- English/Hindi UI dictionaries and language preference; responsive frontend, safe user-text rendering and CSP-compatible action dispatch.
- Audit logging, rate limiting (including IP-wide login bucket), security headers, body/time limits, readiness/health endpoints, maintenance, local backups and restore tooling.
- Backend identifier-verification flow and administrator TOTP MFA flow. Production needs a real HTTPS delivery adapter and real secrets; delivery has only been tested using a mock adapter.
- Additive SQLite migrations, owner-only database/backup permissions on POSIX where supported, configuration validation and production preflight.

## Partially implemented / operationally dependent

- **Identity verification:** backend OTP workflow exists; no email/SMS vendor account or live delivery test is included. Production must be configured and tested before real use.
- **Administrator MFA:** TOTP enrollment and verification exist; secure recovery/backup-code process remains an operational gap.
- **Backups:** local verified backup/restore scripts exist. Off-site encrypted backup and a real restore drill are not verified.
- **Deployment:** Docker/Caddy/nginx/systemd examples exist; public DNS, TLS renewal, firewall, secrets management and host hardening are not verified.
- **Accessibility and localization:** interface includes accessibility-oriented controls and English/Hindi; native-speaker review and tests with real workers are outstanding.
- **Emergency communication:** no complete family-contact and shift-message relay service exists. Do not use this app as an emergency dispatch channel.

## Not implemented (do not advertise as available)

- Family/emergency contacts, relay queue, SMS/WhatsApp notifications and delivery receipts.
- Assisted registration with explicit worker confirmation and auditable facilitator permissions.
- Advance ledger, formal deductions ledger, completed-shift platform fee engine/subscriptions, travel compensation, refunds or real-money transfers.
- Confidential safety complaints, independent dispute appeals, independent attendance verification, verified skills, ratings, 2+1 worker allocation.
- Verified location-specific welfare/health/debt/addiction service directory.
- Production hosting verification, independent security audit/penetration test, field pilot and measured business validation.

## Product constraints

- Workers are not required to use UPI for the current workflow; payment records can represent cash/other reported methods.
- Platform does not hold or transfer funds.
- Attendance sources and payment reports must remain distinguished from independent proof.
- No feature should silently change agreed wage terms, expose family data, or represent queued messages as delivered.

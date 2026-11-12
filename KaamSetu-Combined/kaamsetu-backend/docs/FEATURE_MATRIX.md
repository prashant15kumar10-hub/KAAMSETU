# Feature matrix

This matrix was reconciled against the current source on 2026-10-27. See [`FEATURE_STATUS.md`](FEATURE_STATUS.md) for fuller detail and [`TEST_REPORT.md`](TEST_REPORT.md) for fresh test evidence.

| Feature | Current status |
|---|---|
| Worker/contractor accounts, sessions and roles | Implemented; automated tests pass |
| Job posting, discovery, booking and repeat draft | Implemented; automated tests pass |
| Terms acceptance, duplicate/capacity protection | Implemented; automated tests pass |
| Attendance | Contractor record and worker self-report only; not independently verified |
| Payment records | Reports, acknowledgement, disputes and corrections; no money movement |
| Identity verification | Backend OTP flow; real HTTPS delivery adapter required, only mock-tested |
| Administrator MFA | TOTP enrollment/login; production enforcement default; recovery runbook remains needed |
| CSP and security headers | Inline JS event attributes blocked; inline style attributes still allowed |
| Rate limiting | In-process, bounded; resets on restart and not shared across replicas |
| Backups | Local verified backup/restore scripts; off-site backup not verified |
| Family contacts and emergency relay | Not implemented |
| SMS/WhatsApp notifications | Not implemented; no provider configured |
| Assisted access/facilitator workflow | Not implemented |
| Advance/deduction ledger and platform fees | Not implemented |
| Compensation/refunds/real transfers | Not implemented; policy/provider/legal work required |
| Confidential safety complaints | Not implemented; safety category is refused with guidance |
| Verified help directory | Not included; location-specific information must be independently verified before publishing |
| Browser E2E journey | Not freshly verified in this run; prior report says environment blocked Chromium |
| Production deployment / independent pentest | Not performed |

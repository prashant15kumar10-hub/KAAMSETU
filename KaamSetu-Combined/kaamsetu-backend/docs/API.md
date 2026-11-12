# API reference

Base: `/api`. JSON in/out. Auth: `Authorization: Bearer <token>`.
Errors: `{ "error": { "code": "JOB_FULL", "message": "<localized>", "details": {…}, "request_id": "…" } }` — **switch on `code`**.
Every response carries `X-Request-Id` (send your own `X-Request-Id` of 8-64 safe characters to trace a request). Unexpected failures return `INTERNAL` with a request id and nothing else.
Language: `?lang=hi|en`, `X-Language`, the account's saved language, then `Accept-Language`.
Retry-safe POSTs: send `Idempotency-Key: <unique string>`; a repeat returns the stored response with `Idempotent-Replay: true`.
Money is whole rupees. Dates `YYYY-MM-DD`, times `HH:MM` (India date used for "today").

## Public
| Method | Path | Notes |
|---|---|---|
| GET | /health | liveness (HEAD also works) |
| GET | /ready | readiness for uptime monitors: DB answers; returns `schema_version`, `version`, `uptime_s` (HEAD also works) |
| GET | /capabilities | honest list of implemented / not implemented features |
| GET | /messages?lang= | localized error-message catalog |
| POST | /auth/register | `{identifier, password, name, role: worker\|contractor, lang?, skills?, location?}` → session in development when verification is off; in production `{verification_required:true, identifier, identifier_type}` and no session until verified |
| POST | /auth/login | `{identifier, password}`; may return `verification_required`, `mfa_setup_required` (with one-time setup secret), or `mfa_required` instead of a session |
| POST | /auth/verification/confirm | `{identifier, code}`; confirms control of the registered email/phone; code expires in 10 minutes and is attempt-limited |
| POST | /auth/admin-mfa/setup | `{challenge_token, code}`; completes first administrator TOTP enrollment and returns a session |
| POST | /auth/admin-mfa/verify | `{challenge_token, code}`; verifies administrator TOTP and returns a session |

## Any logged-in user
| Method | Path | Notes |
|---|---|---|
| GET | /auth/me | current user |
| POST | /auth/logout | revokes this token |
| POST | /auth/password | `{current_password, new_password}`; signs out other devices |
| PUT | /me | `{name?, location?, skills? (workers), lang?}` |
| GET | /jobs | open jobs; `?q=&date=&limit=&offset=` |
| GET | /jobs/:id | open jobs; drafts only to owner |
| GET | /bookings/:id | participants/admin only; includes attendance (`verified:false`), history, `payment_summary` |
| GET | /payments/:id | participants/admin only; includes event history |

## Worker
| Method | Path | Notes |
|---|---|---|
| POST | /jobs/:id/accept | `{accept_terms: true, terms_version}` → 201; errors `TERMS_NOT_ACCEPTED`, `TERMS_VERSION_MISMATCH`, `JOB_FULL`, `BOOKING_EXISTS`, `JOB_DATE_PAST` |
| GET | /my/bookings | "Today's work"; `?status=` |
| POST | /bookings/:id/cancel | `{reason?}`; no compensation is calculated |
| POST | /bookings/:id/attendance | self-report arrival `{work_date?}` (unverified) |
| GET | /payments | "My payments" (superseded hidden unless `?include_superseded=1`) |
| POST | /payments/:id/acknowledge | only from `reported` |
| POST | /payments/:id/dispute | `{reason}` from `reported` or `acknowledged` |
| POST/GET | /help | `{category: payment\|booking\|account\|other, message}` — not confidential; `safety` is refused with guidance |

## Contractor
| Method | Path | Notes |
|---|---|---|
| POST | /jobs | create draft; `publish:true` + `confirm_reviewed:true` publishes in one call |
| GET | /my/jobs | own jobs, all statuses |
| PATCH | /jobs/:id | edit; changed terms on an open job bump `terms_version` and require worker re-acceptance (`terms_changed` in response) |
| POST | /jobs/:id/publish | `{confirm_reviewed: true}` |
| POST | /jobs/:id/repeat | new draft from details only; `review_required` lists what to re-check |
| POST | /jobs/:id/cancel, /close | cancel (cancels bookings, no compensation) / close |
| GET | /jobs/:id/bookings | "Today's team", per-worker `arrival_state` |
| POST | /bookings/:id/attendance | `{work_date?, status?: arrived\|absent}` contractor-recorded |
| POST | /bookings/:id/cancel | contractor cancels a worker's booking |
| POST | /bookings/:id/payments | report a payment `{amount, paid_on?, method?, note?}` — a statement, not bank proof |
| POST | /payments/:id/respond | reply to a dispute |
| POST | /payments/:id/correct | `{amount, reason, …}` supersedes the old report; not allowed once acknowledged |
| GET | /payments | payments for own jobs |

## Admin (`create-admin` script only)
`GET /admin/users`, `PATCH /admin/users/:id {disabled}`, `GET /admin/help`, `PATCH /admin/help/:id {status,response}`,
`GET /admin/payments?status=disputed`, `GET /admin/audit`.

## Status vocab (matches frontend i18n keys)
Payment `status_key`: `status_reported` · `status_ack` · `status_disputed` (+ `status_superseded`, not in the frontend dictionary yet).
Arrival states: `arrival_pending` · `self_reported_arrived` · `recorded_arrived` · `recorded_absent`.

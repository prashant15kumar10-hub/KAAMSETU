# Frontend integration (done)

The frontend in `../kaamsetu-frontend` now talks to this API (`js/api.js` + `js/app.js`); the demo `localStorage` data is gone.
Only the language choice (`ks_lang`) and the pre-sign-up role choice (`ks_prerole`, navigation only) stay in `localStorage`;
the session token is in `sessionStorage` (cleared when the tab closes; in-memory fallback if storage is blocked).

| Screen / action | API |
|---|---|
| Register / log in / log out / reload | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Find work, job detail, accept (explicit terms + version) | `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/accept` |
| Today's work, I have arrived, cancel | `GET /my/bookings`, `POST /bookings/:id/attendance`, `/cancel` |
| Post job (review → publish), Repeat, continue/discard draft | `POST /jobs {publish,confirm_reviewed}`, `POST /jobs/:id/repeat`, `PATCH`+`POST /jobs/:id/publish`, `POST /jobs/:id/cancel` |
| Today's team, attendance, close/cancel job | `GET /my/jobs`, `GET /jobs/:id/bookings`, `POST /bookings/:id/attendance`, `/jobs/:id/close`, `/cancel` |
| Booking detail (wage summary, attendance) | `GET /bookings/:id` |
| Payments: report / acknowledge / dispute / reply / correct | `POST /bookings/:id/payments`, `GET /payments`, `/payments/:id/acknowledge|dispute|respond|correct` |
| Help | `POST/GET /help` |
| Language | `X-Language` header on every call; `PUT /me {lang}` after login |

Behaviour: buttons are disabled while a request is in flight; success is shown only after the server answers; a lost response is retried with
the same `Idempotency-Key` (no duplicate job/booking/payment); an expired session returns to login and then back to the same screen with the typed form intact.

Not in the UI (API exists): edit an open job's terms (`PATCH /jobs/:id`), booking history list, administrator screens.
Changed from the original demo: the help text no longer promises confidentiality; the "demo — data only in your browser" footer was replaced;
required-field marking now matches what publishing needs; "workers needed" is a real field (was fixed at 3).

# KAAMSETU — Frontend (connected to the backend API)

Static HTML/CSS/JS, no build step. It needs the KAAMSETU backend: the screens now read and write real server records.

## Run
```bash
cd ../kaamsetu-backend
STATIC_DIR=../kaamsetu-frontend npm start      # API + this site on http://127.0.0.1:3000
```
Frontend hosted elsewhere? Edit `js/config.js` (`KAAMSETU_API_BASE`) and add the site's origin to the backend `ALLOWED_ORIGINS`.

## What it does
- **Language first:** Hindi/English chosen before anything else on a first visit; change from any screen (the form you were typing is kept).
- **Accounts:** register/log in with a mobile number or email + password. The role comes from the server; "I am looking for work / I want to hire" only pre-selects the sign-up form.
- **Worker:** find work, read the full terms and accept them explicitly, today's work (self-report arrival, cancel), payments (acknowledge or dispute), help.
- **Contractor:** guided job posting with review, repeat a job (new draft, date cleared), today's team (confirm attendance, close/cancel), report/correct payments, reply to disputes, help.
- **Honest states:** reported / acknowledged / disputed / owed are separate; attendance and arrival are labelled "not verified"; payments are labelled "not bank proof".
- **Resilience:** buttons lock while a request runs, failures show a message and keep your input, retries cannot duplicate a job/booking/payment, an expired session returns you to the same screen after login.

## Files
`index.html` · `css/style.css` · `js/config.js` (API location) · `js/i18n.js` (Hindi + English dictionaries) · `js/api.js` (API client) · `js/app.js` (screens and actions)

## Not included
Administrator screens (admins use the API), editing an open job's terms, notifications, OTP login, payment gateway, ratings. See `../REPORT.md`.

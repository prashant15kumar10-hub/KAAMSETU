# KAAMSETU Combined Package — Change Log and Validation Report

## Purpose

This package update focuses on the Windows startup problem reported as `ERR_CONNECTION_REFUSED`. The earlier log showed that the backend emitted `server_started`; that proves it bound the listener at that moment, but it does not prove the process remained running when the browser was opened.

The exact reason the user's earlier process stopped cannot be established from the shared log alone. The most common causes are closing/stopping the terminal process, starting from a different working directory, or a port/process mismatch. This update makes startup less dependent on the current working directory and gives clearer diagnostics.

## Files changed or added

### Added: `start-kaamsetu.ps1`

**What it does**
- Resolves project paths from `$PSScriptRoot`, the directory containing the script, rather than relying on the terminal's current directory.
- Verifies that the backend `package.json` and frontend `index.html` exist before starting.
- Verifies that `node` and `npm` are available.
- Enforces the project's documented minimum Node.js version (22.13.0).
- Checks whether the chosen port is already accepting TCP connections and provides a diagnostic instead of starting a second server on the same port.
- Sets `STATIC_DIR` to an absolute frontend path, eliminating ambiguity in the previous relative `../kaamsetu-frontend` setting.
- switches into the backend directory, runs `npm start` in the foreground, and returns to the original directory when it exits.
- Prints the address and reminds the user to keep the terminal open.

**Why**
- Windows users commonly extract a ZIP into a same-named nested directory and then run commands from the wrong folder.
- Relative paths can resolve differently depending on the shell's working directory.
- `ERR_CONNECTION_REFUSED` occurs when no process is accepting connections at that host/port. A foreground launcher plus explicit diagnostics makes that state easier to identify.

**What it does not do**
- It does not keep the server running after the terminal is closed.
- It does not kill existing processes or modify firewall rules.
- It does not change the application's routes, authentication, database schema, or business logic.

### Added: `run-tests.ps1`

**What it does**
- Runs the existing `npm test` command from the correct backend directory regardless of where the terminal was opened, as long as the script is invoked from the project folder.

**Why**
- Prevents `package.json`/working-directory errors when users run tests from the combined project root.

### Updated: `RUN_IN_VSCODE.md`

**What changed**
- Makes the root launcher the recommended Windows start command.
- Explains which folder must be opened in VS Code, including the nested-extraction case.
- Documents `ERR_CONNECTION_REFUSED` troubleshooting and the `Test-NetConnection` check.
- Documents PowerShell execution-policy fallback and alternate-port use.
- Clarifies that the terminal must remain open.

**Why**
- The previous guide relied on manually changing into the backend and setting a relative `STATIC_DIR`, which is valid when done correctly but easy to mistype in a nested extracted folder.

### Application source code

No application source files under `kaamsetu-backend/src` or `kaamsetu-frontend` were changed in this packaging update. The changes are limited to startup/test helper scripts and documentation.

## Validation performed for this package

Executed in the build environment on 2026-10-23 using Node.js v22.16.0 and npm 10.9.2:

- Backend automated tests: **53 passed, 0 failed** (`npm test`, exit code 0).
- Local server smoke test: the server started and shut down cleanly (exit code 0).
- HTTP checks returned **200** for `/`, `/js/config.js`, `/js/api.js`, `/api/health`, `/api/ready`, and `/api/capabilities`.
- `/api/health` returned `ok: true`; `/api/ready` returned `ok: true` and schema version 2.
- The frontend HTML and its API client/configuration files were served by the same backend origin.
- Windows PowerShell scripts: source reviewed for paths and command flow, but **not executed natively on Windows** in this Linux build environment.

The local smoke test used a temporary database and port 39123 to avoid modifying the user's local database or competing with their local port 3000.

## Residual limitations

- The original cause of the user's connection refusal is not proven without the process state at the time of failure.
- A local server test does not verify every browser workflow, production deployment, external integrations, or security posture.
- Keep the server terminal open. If the server stops, restart it and inspect its terminal output.
- If port 3000 is occupied by another program, the launcher will tell you; use `PORT=3001` in the same PowerShell session and start again.


## Security review update

- Added `SECURITY_REVIEW.md` with the scope, evidence, fix, residual risks, and deployment gaps.
- Fixed a confirmed login rate-limit bypass by adding an IP-wide login bucket and a hard bound on in-memory limiter keys.
- Added regression tests for identifier-variation throttling and bounded limiter storage.
- Latest backend suite: 55 tests passed, 0 failed.
- This is not a full penetration test or production deployment verification; see `SECURITY_REVIEW.md`.


## Security hardening update (2026-10-23)

This update changes backend/frontend source code and database schema; it is separate from the original packaging-only startup fix above.

- Added append-only schema migration 3 for verification codes, admin MFA challenges, and TOTP fields. Existing user data is preserved.
- Added production-enforced email/phone verification via a configured HTTPS delivery adapter. OTP codes expire in 10 minutes, are stored as hashes, and have attempt and resend rate limits. Production startup fails when the delivery adapter URL/token or 32+ character verification secret is missing or left as a placeholder; admin MFA also requires a separate 32+ character encryption key.
- Added TOTP administrator MFA: enrollment is required on first production admin login and every subsequent admin login requires a fresh authenticator code. MFA challenges expire and are rate/attempt limited.
- Removed inline JavaScript event-handler attributes from the frontend and tightened CSP to `script-src-attr 'none'`; a literal-only dispatcher avoids `eval` and `Function`. Existing inline styles remain permitted.
- Restricted SQLite database/WAL/SHM and backup files to owner-only POSIX permissions where supported. Added `npm run production-check` to validate production configuration and local checks.
- Added a documented manual penetration-test plan; no independent penetration test or live production verification is claimed.

### Latest validation

- Backend suite: **59 passed, 0 failed** (including identity verification with a mock delivery adapter, TOTP admin enrollment/login, strict-CSP source checks, and action-dispatch parsing).
- Syntax checks passed for changed backend and frontend JavaScript.
- `npm run production-check` passed with a configured test environment; the database did not exist yet, so its permissions must be checked after first startup.
- ZIP integrity check passed. A Chromium browser smoke test was attempted, but browser navigation was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`), so browser user journeys remain unverified.
- Actual DNS/TLS, cloud firewall, host secret permissions, off-site backup restore, and independent penetration testing remain pending until a real staging/production host and authorized test are available.

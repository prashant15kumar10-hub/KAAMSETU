# Operations: logs, alerts, uptime, backups, recovery

## Logs
One JSON object per line (`ts, level, msg, ...`). Each request logs `id, method, path, status, ms, user (id), ip`.
Never logged: passwords, tokens, request bodies, phone/email. 401/403/429 are `warn`, 5xx are `error`, health polls are `debug`.
Every response has `X-Request-Id`; error bodies include `request_id` - ask a user for it (the app shows it as "Reference") and
search the logs for that id. Docker keeps 5×10 MB per container (see compose). For systemd: `journalctl -u kaamsetu -f`.
Useful: `docker compose logs app | grep '"level":"error"'`.

## Audit trail (database table `audit_log`, admin API `GET /api/admin/audit`)
Records admin actions, job cancellations, and auth events (register, login, failed login for existing accounts, logout, password change,
rate-limited, blocked disabled account) with the client IP. Booking and payment histories are in `booking_events` / `payment_events`
and are append-only. **Nothing purges these** - decide a retention rule with legal advice before the tables grow large.

## Alerts
Set `ALERT_WEBHOOK_URL` (https). A JSON POST `{text, content, service, key, time, details}` is sent for: unhandled 500s, handler crashes,
process crashes (then the process exits and Docker/systemd restart it), failed scheduled backups, failed maintenance. The same alert key is
sent at most once per `ALERT_MIN_INTERVAL_SEC` (default 5 min). Delivery was tested only against a local mock receiver, so **confirm your real channel**: with the env loaded run `npm run test-alert`
(Docker: `docker compose exec app npm run test-alert`); it prints whether the webhook answered with HTTP 2xx.
Alerts do **not** detect "the whole server is down" - the server cannot report its own absence. Use an external uptime monitor for that.

## Uptime monitoring
Point any external monitor (UptimeRobot, Better Stack, Healthchecks, your cloud's checks) at `https://DOMAIN/api/ready` every 1-5 min,
expecting HTTP 200 and `"ok":true`. HEAD requests work. `/api/ready` proves the process is up and the database answers; it does **not**
prove free disk space - monitor disk usage on the host (alert at 80%). Docker has a built-in HEALTHCHECK using `scripts/healthcheck.js`.

## Maintenance (automatic, hourly)
Deletes expired/revoked sessions older than 7 days and idempotency replay entries older than 48 h. Nothing else.

## Backups
- `BACKUP_INTERVAL_HOURS=6` (compose default) writes verified snapshots to `BACKUP_DIR` and keeps the newest `BACKUP_KEEP`. Manual: `npm run backup`.
  Each backup is re-opened and integrity-checked; a bad one is deleted and an alert is sent.
- **Same-disk backups do not survive losing the disk or server.** Copy `backups/` somewhere else daily (cloud bucket, another machine). Example
  with rclone (untested; configure a remote first): `rclone copy /var/lib/kaamsetu/backups remote:kaamsetu-backups --max-age 48h`.
  Backups contain personal and financial-record data: encrypt them in transit and at rest and restrict access.
- Suggested starting point (not a legal advice): daily off-site copy, keep 30 days.

## Recovery runbook
**Process crashed / won't start**: `docker compose logs --tail 100 app` (or `journalctl -u kaamsetu -n 100`). A `config_error` line says exactly which setting is wrong.
**Bad deploy**: redeploy the previous version; migrations only add indexes/tables, so older code keeps working with a newer schema unless a future migration says otherwise.
**Data damaged or lost - restore**
1. Stop the app: `docker compose stop app` (systemd: `systemctl stop kaamsetu`).
2. Pick a backup: `ls -1 backups/` (names are timestamps).
3. `npm run restore -- /path/to/kaamsetu-<time>.db --yes` (Docker: `docker compose run --rm app node --no-warnings scripts/restore.js /data/backups/<file> --yes`).
   The backup is verified first; the current database is kept as `kaamsetu.db.pre-restore-<time>`.
4. Start the app, check `/api/ready` and log in with a known account.
5. Anything written after the backup time is lost: tell affected users; booking and payment disagreements after a restore must be settled by hand.
**Do a restore drill on a spare machine before you need it.**
**Suspected account compromise**: admin `PATCH /api/admin/users/:id {"disabled":true}` revokes that user's sessions; review `/api/admin/audit`.
**Secrets leaked** (webhook URL): rotate it at the provider and update the env file. There are no other secrets: sessions are random tokens stored hashed.

## Known operational limits
Single process + SQLite: fine for a pilot; no horizontal scaling. Login rate-limit counters live in memory (reset on restart).
No automatic disk-space check, no metrics dashboard, no log shipping - add those with your host's tools.

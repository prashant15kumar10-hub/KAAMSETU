# Deployment

Two supported routes. **Neither was run in the environment where this was written** (no Docker/Caddy/nginx there):
the application itself (config validation, headers, health check, backup/restore, shutdown, crash alert) was run and tested;
the container and proxy files below are standard but unverified. Do a staging deploy first.

## What you must provide
- A server (Linux VM) with ports 80/443 reachable, and a **domain name whose DNS points to it** (needed for HTTPS certificates).
- Docker + Docker Compose **or** Node.js 22.13+ with systemd and nginx.
- Optional: an https webhook URL for alerts, an uptime monitor account, a place to copy backups off the server.
- Configure an HTTPS email/SMS delivery adapter implementing the JSON contract in `SECURITY_IMPLEMENTATION_AND_TEST_PLAN.md`; set its URL/token a 32+ character verification-code secret, and a separate 32+ character MFA encryption key in the secret manager or protected `.env`. Never commit real values.
- Decide data residency/hosting jurisdiction and get legal review of privacy obligations (not covered here).

## Route A — Docker + Caddy (automatic HTTPS)
```bash
cd deploy
cp .env.production.example .env      # set DOMAIN, optionally ALERT_WEBHOOK_URL
docker compose up -d --build
docker compose logs -f app           # JSON logs; look for server_started
curl https://YOUR-DOMAIN/api/ready   # schema_version should be 3 or newer
# create the first administrator (admins can never self-register):
docker compose exec -e ADMIN_IDENTIFIER=you@example.com -e ADMIN_PASSWORD='at-least-12-chars' app node --no-warnings scripts/create-admin.js
```
Data lives in the `kaamsetu-data` volume (`/data`): `kaamsetu.db` and `backups/`. Caddy stores certificates in `caddy-data`.

## Route B — systemd + nginx
1. Copy the project to `/opt/kaamsetu`; create user `kaamsetu`; `mkdir -p /var/lib/kaamsetu /etc/kaamsetu`.
2. Copy `deploy/.env.production.example` to `/etc/kaamsetu/kaamsetu.env`, uncomment the systemd lines, `chmod 600` it.
3. `cp deploy/kaamsetu.service /etc/systemd/system/ && systemctl enable --now kaamsetu`.
4. Install `deploy/nginx.conf` (edit the domain), run certbot for the certificate, `nginx -s reload`.
5. Check: `curl https://YOUR-DOMAIN/api/ready`. Before a real launch, complete the manual checks listed in `SECURITY_IMPLEMENTATION_AND_TEST_PLAN.md`; local tests do not verify the live host.

## Production checklist
- [ ] `npm run production-check` passes inside the configured deployment environment; review all warnings.
- [ ] Email and SMS verification codes are actually delivered by the configured adapter, expire, and reject reused/incorrect codes.
- [ ] First admin completes authenticator-app MFA enrollment; securely document an out-of-band recovery procedure.
- [ ] `NODE_ENV=production`; the server refuses to start on invalid settings and prints warnings for risky ones.
- [ ] HTTPS works and HTTP redirects; HSTS header present (`curl -I https://DOMAIN/`).
- [ ] `TRUST_PROXY=true` **only** because a proxy you control is the sole way in; the proxy must *set* `X-Forwarded-For` (sample configs do).
- [ ] `ALLOWED_ORIGINS` empty (same-origin) unless the frontend is hosted on another domain.
- [ ] Alert webhook configured **and a test alert received** (see OPERATIONS.md).
- [ ] An external uptime monitor polls `https://DOMAIN/api/ready` (HEAD or GET).
- [ ] Backups run, are copied off the server, and a **restore drill** has been done.
- [ ] First admin created; no seed/demo data (`npm run seed` refuses to run in production).
- [ ] Firewall allows only 80/443 (+ SSH from your IP); the app port 3000 is not public.
- [ ] An authorized independent penetration test has been completed on staging and findings remediated; the included checks are not a substitute.

## Updating
Docker: `git pull` (or copy new files), `docker compose up -d --build` (production startup intentionally fails until the required verification delivery adapter settings are configured). Migrations are append-only and run automatically at start; the
database is never dropped. **Take a backup first** (`docker compose exec app npm run backup`).

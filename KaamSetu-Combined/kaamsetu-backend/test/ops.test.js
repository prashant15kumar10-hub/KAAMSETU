'use strict';
const { RateLimiter } = require('../src/security');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer } = require('./helpers');
const { createLogger } = require('../src/logger');
const { createAlerter } = require('../src/alerts');
const { loadConfig, validateConfig } = require('../src/config');
const { openDb, MIGRATIONS, now } = require('../src/db');
const { runMaintenance } = require('../src/maintenance');
const { backupDatabase, pruneBackups, restoreBackup, verifyDbFile } = require('../src/backup');
const S = require('../src/security');
const { DatabaseSync } = require('node:sqlite');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ks-test-'));

test('rate limiter bounds memory when requests use unique keys', () => {
  const limiter = new RateLimiter({ maxEntries: 3, cleanupEvery: 1 });
  assert.equal(limiter.hit('a', 10, 60000), true);
  assert.equal(limiter.hit('b', 10, 60000), true);
  assert.equal(limiter.hit('c', 10, 60000), true);
  assert.equal(limiter.hit('d', 10, 60000), true);
  assert.equal(limiter.m.size, 3, 'unique keys must not grow the Map beyond its configured cap');
});

test('request ids, structured logs and no secrets in logs', async (t) => {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: l => lines.push(JSON.parse(l)) });
  const s = await startServer({}, { logger });
  t.after(s.close);
  const reg = await s.call('POST', '/api/auth/register', { body: { identifier: '9876543210', password: 'Sup3rSecret!pw', name: 'Asha', role: 'worker' } });
  assert.equal(reg.status, 201);
  assert.match(reg.headers.get('x-request-id'), /^[a-f0-9]{16}$/);
  const echoed = await s.call('GET', '/api/health', { headers: { 'X-Request-Id': 'trace-12345678' } });
  assert.equal(echoed.headers.get('x-request-id'), 'trace-12345678');
  const bad = await s.call('GET', '/api/health', { headers: { 'X-Request-Id': 'x"\'<script>' } });
  assert.notEqual(bad.headers.get('x-request-id'), 'x"\'<script>');
  await s.call('GET', '/api/auth/me', { token: reg.body.token });
  await new Promise(r => setTimeout(r, 30));
  const dump = JSON.stringify(lines);
  assert.ok(lines.some(l => l.msg === 'request' && l.path === '/api/auth/register' && l.status === 201 && typeof l.ms === 'number'));
  assert.ok(lines.some(l => l.msg === 'request' && l.path === '/api/auth/me' && l.user === reg.body.user.id));
  assert.ok(!dump.includes('Sup3rSecret'), 'password must never be logged');
  assert.ok(!dump.includes(reg.body.token), 'session token must never be logged');
  assert.ok(!dump.includes('9876543210'), 'phone number must not be logged');
  assert.ok(lines.filter(l => l.path === '/api/health').every(l => l.level === 'debug'), 'health polls are debug-level');
  const err404 = await s.call('GET', '/api/nope');
  assert.equal(err404.body.error.code, 'NOT_FOUND');
  assert.ok(err404.body.error.request_id);
});

test('security headers: CSP, permissions policy, HSTS only when enabled', async (t) => {
  const a = await startServer(); t.after(a.close);
  const h = (await a.call('GET', '/api/health')).headers;
  assert.match(h.get('content-security-policy'), /default-src 'self'/);
  assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(h.get('content-security-policy'), /connect-src 'self'/);
  assert.match(h.get('content-security-policy'), /script-src-attr 'none'/);
  assert.doesNotMatch(h.get('content-security-policy'), /script-src-attr 'unsafe-inline'/);
  assert.equal(h.get('permissions-policy').includes('geolocation=()'), true);
  assert.equal(h.get('strict-transport-security'), null);
  const b = await startServer({ hsts: true }); t.after(b.close);
  assert.match((await b.call('GET', '/api/health')).headers.get('strict-transport-security'), /max-age=31536000/);
});

test('readiness endpoint reports schema version', async (t) => {
  const s = await startServer(); t.after(s.close);
  const r = await s.call('GET', '/api/ready');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.schema_version, MIGRATIONS[MIGRATIONS.length - 1].id);
  assert.equal(typeof r.body.uptime_s, 'number');
});

test('unexpected failures: generic 500 with request id, logged, alerted once (throttled), nothing leaked', async (t) => {
  const lines = []; const sent = [];
  const logger = createLogger({ level: 'debug', write: l => lines.push(JSON.parse(l)) });
  const alerter = createAlerter({ url: 'https://hooks.example.test/x', minIntervalSec: 300, logger,
    fetchImpl: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; } });
  const s = await startServer({}, { logger, alerter });
  const reg = await s.call('POST', '/api/auth/register', { body: { identifier: 'w1@example.com', password: 'Passw0rd!x', name: 'W', role: 'worker' } });
  s.db.close(); // simulate the database becoming unavailable
  const r1 = await s.call('GET', '/api/jobs', { token: reg.body.token });
  const r2 = await s.call('GET', '/api/jobs', { token: reg.body.token });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(r1.status, 500);
  assert.equal(r1.body.error.code, 'INTERNAL');
  assert.ok(r1.body.error.request_id);
  assert.ok(!JSON.stringify(r1.body).includes('node:sqlite') && !JSON.stringify(r1.body).includes('at '), 'no stack/internal detail to client');
  assert.equal(r2.status, 500);
  assert.ok(lines.some(l => l.msg === 'unhandled_error' && l.err && l.err.stack));
  assert.equal(sent.length, 1, 'second identical alert is throttled');
  assert.match(sent[0].body.text, /Unhandled server error/);
  assert.ok(!JSON.stringify(sent[0].body).includes('Passw0rd'));
  await new Promise(r => s.server ? s.server.close(r) : r());
});

test('alerter: webhook payload, failure tolerance, throttling', async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/hook`;
  const logs = []; const logger = createLogger({ level: 'debug', write: l => logs.push(JSON.parse(l)) });
  const a = createAlerter({ url, minIntervalSec: 300, logger });
  assert.equal(await a.notify('k1', 'disk is on fire'), true);
  assert.equal(await a.notify('k1', 'disk is still on fire'), false); // throttled
  assert.equal(await a.notify('k2', 'different problem'), true);
  assert.equal(got.length, 2);
  assert.equal(got[0].service, 'kaamsetu'); assert.match(got[0].text, /disk is on fire/); assert.equal(got[0].content, got[0].text);
  srv.close();
  const dead = createAlerter({ url: 'http://127.0.0.1:1/none', minIntervalSec: 1, logger });
  assert.equal(await dead.notify('k', 'x'), false); // must not throw
  assert.ok(logs.some(l => l.msg === 'alert_delivery_failed'));
  const none = createAlerter({ url: '', logger });
  assert.equal(none.enabled, false);
  assert.equal(await none.notify('k', 'only logged'), false);
});

test('malformed URLs are client errors, not server errors', async (t) => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  const s = await startServer({ staticDir: dir }); t.after(s.close);
  const a = await s.call('GET', '/api/jobs/%E0%A4%A', { token: 'x' });
  assert.ok(a.status === 404 || a.status === 401, 'status ' + a.status);
  const b = await fetch(s.base + '/%E0%A4%A'); assert.equal(b.status, 400);
  const c = await fetch(s.base + '/'); assert.equal(c.status, 200); assert.equal(c.headers.get('cache-control'), 'no-cache');
  assert.match(c.headers.get('content-security-policy'), /default-src/);
});

test('maintenance removes only dead sessions and old replay keys; records are untouched', async (t) => {
  const s = await startServer(); t.after(s.close);
  const w = await s.register('w@example.com', 'worker');
  const cfg = loadConfig({});
  const iso = d => new Date(Date.now() + d * 86400e3).toISOString();
  const addSess = (n, created, expires, revoked) => s.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked) VALUES (?,?,?,?,?)').run(n, w.id, created, expires, revoked);
  addSess('old_expired', iso(-30), iso(-20), 0);
  addSess('old_revoked', iso(-30), iso(+5), 1);
  addSess('recent_revoked', iso(-1), iso(+5), 1);
  addSess('live', iso(-1), iso(+5), 0);
  const idem = (k, ageH) => s.db.prepare('INSERT INTO idempotency (key,user_id,request_sig,status,body,created_at) VALUES (?,?,?,?,?,?)').run(k, w.id, 'sig', 200, '{}', new Date(Date.now() - ageH * 3600e3).toISOString());
  idem('old', 100); idem('fresh', 1);
  s.db.prepare("INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES ('u','x','', '{}', ?)").run(iso(-400));
  const auditBefore = s.db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  const r = runMaintenance(s.db, cfg);
  assert.equal(r.sessions_removed, 2); assert.equal(r.idempotency_removed, 1);
  const left = s.db.prepare('SELECT token_hash FROM sessions').all().map(x => x.token_hash);
  assert.ok(left.includes('live') && left.includes('recent_revoked') && !left.includes('old_expired') && !left.includes('old_revoked'));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM idempotency').get().n, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, auditBefore, 'audit log is never purged');
  assert.equal((await s.call('GET', '/api/auth/me', { token: w.token })).status, 200, 'real session still works');
});

test('backup is verified, restore round-trips, bad files are rejected without damage', async (t) => {
  const dir = tmp(); const dbPath = path.join(dir, 'k.db'); const bdir = path.join(dir, 'backups');
  const db = openDb(dbPath);
  const ins = id => db.prepare("INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)").run(id, id + '@example.com', 'email', id, 'worker', 'x', now());
  ins('alice'); ins('bob');
  const b1 = backupDatabase(db, bdir);
  assert.equal(verifyDbFile(b1).migrations, MIGRATIONS.length);
  db.prepare("DELETE FROM users WHERE id='bob'").run(); ins('carol');
  db.close();
  const r = restoreBackup(b1, dbPath);
  assert.ok(r.previousDatabaseSavedAs && fs.existsSync(r.previousDatabaseSavedAs), 'previous DB kept');
  const db2 = openDb(dbPath);
  assert.deepEqual(db2.prepare('SELECT id FROM users ORDER BY id').all().map(x => x.id), ['alice', 'bob']);
  db2.close();
  // corrupted backup -> rejected, live DB untouched
  const bad = path.join(dir, 'bad.db'); fs.writeFileSync(bad, Buffer.from('this is not a database '.repeat(200)));
  assert.throws(() => restoreBackup(bad, dbPath));
  // valid SQLite file that is not a KAAMSETU database -> rejected
  const other = path.join(dir, 'other.db'); const o = new DatabaseSync(other); o.exec('CREATE TABLE t(x)'); o.close();
  assert.throws(() => restoreBackup(other, dbPath), /schema_migrations|not a KAAMSETU/);
  const db3 = openDb(dbPath); assert.equal(db3.prepare('SELECT COUNT(*) n FROM users').get().n, 2); db3.close();
  assert.throws(() => restoreBackup(dbPath, dbPath), /same file/);
  // retention
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(bdir, `kaamsetu-2026-01-0${i + 1}T00-00-00-000Z.db`), 'x');
  const removed = pruneBackups(bdir, 3);
  assert.equal(removed.length, fs.readdirSync(bdir).length === 3 ? 3 : removed.length);
  assert.equal(fs.readdirSync(bdir).filter(f => f.endsWith('.db')).length, 3);
  assert.ok(fs.readdirSync(bdir).some(f => f.includes('2026-01-05')), 'newest files are kept');
});

test('config validation fails fast on unsafe settings', () => {
  const e = (env) => validateConfig(loadConfig(env));
  assert.deepEqual(e({}).errors, []);
  assert.ok(e({ PORT: 'abc' }).errors.some(x => /PORT/.test(x)));
  assert.ok(e({ ALLOWED_ORIGINS: '*' }).errors.some(x => /not \*/.test(x)));
  assert.ok(e({ ALLOWED_ORIGINS: 'https://a.example.com/path' }).errors.length);
  assert.ok(e({ ALLOWED_ORIGINS: 'nonsense' }).errors.length);
  assert.ok(e({ LOG_LEVEL: 'loud' }).errors.length);
  assert.ok(e({ SESSION_TTL_HOURS: '0' }).errors.length);
  assert.ok(e({ NODE_ENV: 'production', ALERT_WEBHOOK_URL: 'http://hooks.example.com/x' }).errors.some(x => /https/.test(x)));
  assert.ok(e({ NODE_ENV: 'production', DB_PATH: ':memory:' }).errors.length);
  const prod = loadConfig({ NODE_ENV: 'production' });
  assert.ok(validateConfig(prod).errors.some(x => /VERIFICATION_DELIVERY_URL/.test(x)));
  assert.ok(validateConfig(prod).errors.some(x => /MFA_ENCRYPTION_KEY/.test(x)));
  assert.deepEqual(prod.allowedOrigins, [], 'production does not default to localhost origins');
  assert.equal(prod.hsts, true);
  const w = validateConfig(prod).warnings.join(' ');
  assert.match(w, /TRUST_PROXY/); assert.match(w, /ALERT_WEBHOOK_URL/); assert.match(w, /BACKUP_INTERVAL_HOURS/);
  assert.deepEqual(validateConfig(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: 'true', ALERT_WEBHOOK_URL: 'https://h.example.com/x', BACKUP_INTERVAL_HOURS: '6', VERIFICATION_DELIVERY_URL: 'https://verify.test-company.invalid/send', VERIFICATION_DELIVERY_TOKEN: 'p'.repeat(32), VERIFICATION_CODE_SECRET: 'x'.repeat(32), MFA_ENCRYPTION_KEY: 'y'.repeat(32) })).warnings, []);
});

test('migration 2 upgrades an existing v1 database without touching its data', () => {
  const dir = tmp(); const file = path.join(dir, 'old.db');
  const d = new DatabaseSync(file); d.exec('PRAGMA foreign_keys=ON');
  d.exec(MIGRATIONS[0].sql);
  d.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  d.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run('init', now());
  d.prepare("INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, created_at) VALUES ('u1','a@example.com','email','Old User','worker','h',?)").run(now());
  d.close();
  const db = openDb(file);
  assert.equal(db.prepare("SELECT name FROM users WHERE id='u1'").get().name, 'Old User');
  assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(x => x.id), [1, 2, 3]);
  assert.ok(db.prepare("PRAGMA table_info(users)").all().some(x => x.name === 'mfa_enabled'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='verification_codes'").get());
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(x => x.name);
  for (const n of ['idx_idempotency_created', 'idx_booking_events_booking', 'idx_audit_created']) assert.ok(idx.includes(n), n);
  db.close(); openDb(file).close(); // re-opening is a no-op
});

test('audit trail records auth events, never passwords, and does not let strangers fill it', async (t) => {
  const s = await startServer(); t.after(s.close);
  const adminId = s.makeAdmin();
  const w = await s.register('9123456789', 'worker', 'Ravi');
  await s.call('POST', '/api/auth/login', { body: { identifier: '9123456789', password: 'WrongPassword1' } });
  await s.call('POST', '/api/auth/login', { body: { identifier: '9000000999', password: 'WhateverPass1' } }); // unknown account
  const ok = await s.call('POST', '/api/auth/login', { body: { identifier: '9123456789', password: 'Passw0rd!x' } });
  await s.call('POST', '/api/auth/logout', { token: ok.body.token });
  const adm = await s.call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: 'AdminPassw0rd!' } });
  const a = await s.call('GET', '/api/admin/audit', { token: adm.body.token });
  const acts = a.body.audit.filter(x => x.actor_id === w.id).map(x => x.action);
  for (const need of ['auth.register', 'auth.login_failed', 'auth.login', 'auth.logout']) assert.ok(acts.includes(need), need + ' in ' + acts);
  assert.equal(a.body.audit.filter(x => x.action === 'auth.login_failed').length, 1, 'unknown-identifier failures are not stored');
  assert.ok(!JSON.stringify(a.body).includes('WrongPassword1') && !JSON.stringify(a.body).includes('Passw0rd'));
  void adminId;
});

test('authorization matrix: every protected route rejects anonymous users and wrong roles', async (t) => {
  const s = await startServer(); t.after(s.close);
  s.makeAdmin();
  const worker = await s.register('w@example.com', 'worker');
  const contractor = await s.register('c@example.com', 'contractor');
  const adm = await s.call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: 'AdminPassw0rd!' } });
  const tokens = { worker: worker.token, contractor: contractor.token, admin: adm.body.token };
  const routes = s.server_router.routes.filter(r => r.opts.auth !== false);
  assert.ok(routes.length >= 30, 'route table found: ' + routes.length);
  let checked = 0;
  for (const r of routes) {
    const p = r.pattern.replace(/:\w+/g, 'doesnotexist');
    const anon = await s.call(r.method, p, { body: r.method === 'GET' ? undefined : {} });
    assert.equal(anon.status, 401, `anonymous ${r.method} ${r.pattern} -> ${anon.status}`);
    if (Array.isArray(r.opts.roles)) {
      for (const role of Object.keys(tokens).filter(x => !r.opts.roles.includes(x))) {
        const res = await s.call(r.method, p, { token: tokens[role], body: r.method === 'GET' ? undefined : {} });
        assert.equal(res.status, 403, `${role} on ${r.method} ${r.pattern} -> ${res.status}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 30, 'role checks run: ' + checked);
});

test('registration is rate limited', async (t) => {
  const s = await startServer({ rate: { loginMax: 10, loginWindowMs: 60000, registerMax: 5, registerWindowMs: 60000 } }); t.after(s.close);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await s.call('POST', '/api/auth/register', { body: { identifier: `u${i}@example.com`, password: 'Passw0rd!x', name: 'U', role: 'worker' } })).status);
  assert.deepEqual(codes.slice(0, 5), [201, 201, 201, 201, 201]);
  assert.deepEqual(codes.slice(5), [429, 429]);
});

test('HEAD works for static files and health endpoints (uptime monitors)', async (t) => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  const s = await startServer({ staticDir: dir }); t.after(s.close);
  const a = await fetch(s.base + '/', { method: 'HEAD' }); assert.equal(a.status, 200); assert.equal(await a.text(), '');
  const b = await fetch(s.base + '/api/ready', { method: 'HEAD' }); assert.equal(b.status, 200);
  const c = await fetch(s.base + '/api/jobs', { method: 'HEAD' }); assert.equal(c.status, 401, 'HEAD does not bypass authentication');
});

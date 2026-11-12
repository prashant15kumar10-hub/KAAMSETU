'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers');
const S = require('../src/security');

test('production identity verification blocks sessions until a delivered OTP is confirmed', async (t) => {
  let lastDelivery = null;
  const provider = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      assert.equal(req.headers.authorization, 'Bearer test-provider-token');
      lastDelivery = JSON.parse(body); res.writeHead(204); res.end();
    });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const url = `http://127.0.0.1:${provider.address().port}/deliver`;
  const s = await startServer({ requireIdentifierVerification: true, verificationDeliveryUrl: url,
    verificationDeliveryToken: 'test-provider-token', verificationCodeSecret: 'test-verification-secret-0123456789' });
  t.after(s.close);
  const reg = await s.call('POST', '/api/auth/register', { body: { identifier: 'verify@example.com', password: 'Passw0rd!x', name: 'Verify', role: 'worker' } });
  assert.equal(reg.status, 201); assert.equal(reg.body.verification_required, true); assert.equal(reg.body.token, undefined);
  assert.equal(lastDelivery.channel, 'email'); assert.equal(lastDelivery.purpose, 'account_verification');
  const loginBefore = await s.call('POST', '/api/auth/login', { body: { identifier: 'verify@example.com', password: 'Passw0rd!x' } });
  assert.equal(loginBefore.body.verification_required, true); assert.equal(loginBefore.body.token, undefined);
  const confirm = await s.call('POST', '/api/auth/verification/confirm', { body: { identifier: 'verify@example.com', code: lastDelivery.code } });
  assert.equal(confirm.status, 200); assert.equal(confirm.body.verified, true);
  const loginAfter = await s.call('POST', '/api/auth/login', { body: { identifier: 'verify@example.com', password: 'Passw0rd!x' } });
  assert.equal(loginAfter.status, 200); assert.ok(loginAfter.body.token);
});

test('administrator login requires TOTP enrollment once and a valid TOTP thereafter', async (t) => {
  const s = await startServer({ requireAdminMfa: true }); t.after(s.close);
  s.makeAdmin();
  const login = () => s.call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: 'AdminPassw0rd!' } });
  const first = await login();
  assert.equal(first.body.mfa_setup_required, true); assert.equal(first.body.token, undefined);
  const code = S.totpCode(first.body.secret);
  const setup = await s.call('POST', '/api/auth/admin-mfa/setup', { body: { challenge_token: first.body.challenge_token, code } });
  assert.equal(setup.status, 200); assert.ok(setup.body.token); assert.equal(setup.body.user.role, 'admin');
  const storedSecret = s.db.prepare("SELECT mfa_secret FROM users WHERE identifier='admin@example.com'").get().mfa_secret;
  assert.notEqual(storedSecret, first.body.secret); assert.match(storedSecret, /^v1\./, 'TOTP secret is encrypted at rest');
  const second = await login();
  assert.equal(second.body.mfa_required, true); assert.equal(second.body.token, undefined);
  const verify = await s.call('POST', '/api/auth/admin-mfa/verify', { body: { challenge_token: second.body.challenge_token, code: S.totpCode(first.body.secret) } });
  assert.equal(verify.status, 200); assert.ok(verify.body.token);
  const badLogin = await login();
  const bad = await s.call('POST', '/api/auth/admin-mfa/verify', { body: { challenge_token: badLogin.body.challenge_token, code: '000000' } });
  assert.equal(bad.status, 401);
});

test('frontend removes inline JavaScript handlers for strict CSP', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../../kaamsetu-frontend/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../kaamsetu-frontend/js/app.js'), 'utf8');
  assert.doesNotMatch(html, /on(?:click|change|submit|input|load)=/i);
  assert.doesNotMatch(app, /on(?:click|change|submit|input|load)=/i);
  assert.match(app, /data-action=/); assert.match(app, /no eval\/Function/);
});

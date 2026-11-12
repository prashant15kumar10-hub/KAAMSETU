'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const S = require('../security');
const i18n = require('../i18n');
const { now, tx } = require('../db');
const { publicUser, audit } = require('../services');

function normalizeIdentifier(raw) {
  if (typeof raw !== 'string') throw new ApiError(422, 'IDENTIFIER_INVALID');
  const v = V.clean(raw);
  if (/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v) && v.length <= 254) return { id: v.toLowerCase(), type: 'email' };
  const digits = v.replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return { id: digits, type: 'phone' };
  throw new ApiError(422, 'IDENTIFIER_INVALID');
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) throw new ApiError(422, 'PASSWORD_WEAK');
}
async function issueVerificationCode({ db, cfg, user, ip, limiter }) {
  if (!cfg.requireIdentifierVerification) return;
  if (!cfg.verificationDeliveryUrl || !cfg.verificationDeliveryToken || cfg.verificationCodeSecret.length < 32) throw new ApiError(503, 'VERIFICATION_UNAVAILABLE');
  if (!limiter.hit(`verify:${ip}:${user.id}`, 5, 15 * 60 * 1000)) throw new ApiError(429, 'RATE_LIMITED');
  const code = S.newOtp();
  db.prepare(`INSERT INTO verification_codes (user_id, code_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at`)
    .run(user.id, S.sha256(`${user.id}:${code}:${cfg.verificationCodeSecret}`), new Date(Date.now() + 10 * 60 * 1000).toISOString(), 0, now());
  try {
    const res = await fetch(cfg.verificationDeliveryUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.verificationDeliveryToken}` },
      body: JSON.stringify({ to: user.identifier, channel: user.identifier_type, code, purpose: 'account_verification', expires_in_seconds: 600 }), signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`delivery provider returned ${res.status}`);
  } catch {
    db.prepare('DELETE FROM verification_codes WHERE user_id=?').run(user.id);
    throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED');
  }
}
function createMfaChallenge(db, user, purpose) {
  const token = S.newToken();
  db.prepare('INSERT INTO auth_challenges (token_hash,user_id,purpose,expires_at,attempts,created_at) VALUES (?,?,?,?,0,?)')
    .run(S.sha256(token), user.id, purpose, new Date(Date.now() + 10 * 60 * 1000).toISOString(), now());
  return token;
}
function startSession(db, cfg, userId) {
  const token = S.newToken();
  const expires = new Date(Date.now() + cfg.sessionTtlHours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(S.sha256(token), userId, now(), expires);
  return { token, expires_at: expires };
}

module.exports = function (r) {
  // Role here is the ACCOUNT role chosen at sign-up. 'admin' can never be self-assigned.
  r.add('POST', '/api/auth/register', { auth: false }, async ({ db, cfg, body, ip, limiter, lang }) => {
    if (!limiter.hit('reg:' + ip, cfg.rate.registerMax, cfg.rate.registerWindowMs)) throw new ApiError(429, 'RATE_LIMITED');
    const { id, type } = normalizeIdentifier(body.identifier);
    checkPassword(body.password);
    const name = V.str(body, 'name', { req: true, max: 80 });
    const role = body.role;
    if (role !== 'worker' && role !== 'contractor') throw new ApiError(422, 'ROLE_INVALID');
    const chosen = body.lang === undefined ? (i18n.pickLang(lang) || 'en') : i18n.pickLang(body.lang);
    if (!chosen) throw new ApiError(422, 'LANG_UNSUPPORTED');
    const skills = V.str(body, 'skills', { max: 200 }) || '';
    const location = V.str(body, 'location', { max: 120 }) || '';
    const userId = S.newId('u');
    const hash = S.hashPassword(body.password);
    const out = tx(db, () => {
      if (db.prepare('SELECT 1 FROM users WHERE identifier=?').get(id)) throw new ApiError(409, 'IDENTIFIER_TAKEN');
      db.prepare(`INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, lang, skills, location, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(userId, id, type, name, role, hash, chosen, role === 'worker' ? skills : '', location, now());
      return cfg.requireIdentifierVerification ? null : startSession(db, cfg, userId);
    });
    const created = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (cfg.requireIdentifierVerification) {
      try { await issueVerificationCode({ db, cfg, user: created, ip, limiter }); }
      catch (e) { db.prepare('DELETE FROM users WHERE id=?').run(userId); throw e; }
      audit(db, userId, 'auth.register', userId, { role, ip });
      return { __status: 201, body: { verification_required: true, identifier: created.identifier, identifier_type: created.identifier_type } };
    }
    audit(db, userId, 'auth.register', userId, { role, ip });
    return { __status: 201, body: { ...out, user: publicUser(created) } };
  });

  r.add('POST', '/api/auth/login', { auth: false }, async ({ db, cfg, body, ip, limiter }) => {
    let norm;
    try { norm = normalizeIdentifier(body.identifier); } catch { throw new ApiError(401, 'INVALID_CREDENTIALS'); }
    // Apply an IP-wide bucket as well as an identifier-specific bucket. Without the first,
    // an attacker can bypass the login limit by varying the email/phone on every attempt.
    const ipKey = `login-ip:${ip}`;
    const key = `login:${ip}:${norm.id}`;
    const u0 = db.prepare('SELECT id FROM users WHERE identifier=?').get(norm.id);
    const ipMax = cfg.rate.loginIpMax || cfg.rate.loginMax * 5;
    if (!limiter.hit(ipKey, ipMax, cfg.rate.loginWindowMs) ||
        !limiter.hit(key, cfg.rate.loginMax, cfg.rate.loginWindowMs)) {
      if (u0) audit(db, u0.id, 'auth.rate_limited', u0.id, { ip });
      throw new ApiError(429, 'RATE_LIMITED');
    }
    const u = db.prepare('SELECT * FROM users WHERE identifier=?').get(norm.id);
    const ok = S.verifyPassword(typeof body.password === 'string' ? body.password : '', u ? u.password_hash : S.DUMMY_HASH);
    // Failed logins are audited only for real accounts (so attackers cannot fill the audit log with made-up identifiers).
    if (!u || !ok) { if (u) audit(db, u.id, 'auth.login_failed', u.id, { ip }); throw new ApiError(401, 'INVALID_CREDENTIALS'); }
    if (u.disabled) { audit(db, u.id, 'auth.login_blocked_disabled', u.id, { ip }); throw new ApiError(403, 'ACCOUNT_DISABLED'); }
    limiter.clear(key);
    if (cfg.requireIdentifierVerification && !u.identifier_verified) {
      await issueVerificationCode({ db, cfg, user: u, ip, limiter });
      return { verification_required: true, identifier: u.identifier, identifier_type: u.identifier_type };
    }
    if (cfg.requireAdminMfa && u.role === 'admin') {
      if (!u.mfa_enabled) {
        const secret = u.mfa_pending_secret ? S.decryptSecret(u.mfa_pending_secret, cfg.mfaEncryptionKey) : S.newTotpSecret();
        if (!u.mfa_pending_secret) db.prepare('UPDATE users SET mfa_pending_secret=? WHERE id=?').run(S.encryptSecret(secret, cfg.mfaEncryptionKey), u.id);
        return { mfa_setup_required: true, challenge_token: createMfaChallenge(db, u, 'admin_mfa_setup'), secret };
      }
      return { mfa_required: true, challenge_token: createMfaChallenge(db, u, 'admin_mfa_verify') };
    }
    audit(db, u.id, 'auth.login', u.id, { ip });
    return { ...startSession(db, cfg, u.id), user: publicUser(u) };
  });

  r.add('POST', '/api/auth/verification/confirm', { auth: false }, ({ db, cfg, body, ip, limiter }) => {
    let norm; try { norm = normalizeIdentifier(body.identifier); } catch { throw new ApiError(400, 'VERIFICATION_INVALID'); }
    const u = db.prepare('SELECT * FROM users WHERE identifier=?').get(norm.id);
    if (!u || !/^\d{6}$/.test(String(body.code || ''))) throw new ApiError(400, 'VERIFICATION_INVALID');
    const v = db.prepare('SELECT * FROM verification_codes WHERE user_id=?').get(u.id);
    if (!v || v.expires_at < now() || v.attempts >= 5) { db.prepare('DELETE FROM verification_codes WHERE user_id=?').run(u.id); throw new ApiError(400, 'VERIFICATION_INVALID'); }
    const expected = S.sha256(`${u.id}:${body.code}:${cfg.verificationCodeSecret}`);
    if (!require('crypto').timingSafeEqual(Buffer.from(expected), Buffer.from(v.code_hash))) {
      db.prepare('UPDATE verification_codes SET attempts=attempts+1 WHERE user_id=?').run(u.id);
      throw new ApiError(400, 'VERIFICATION_INVALID');
    }
    db.prepare('UPDATE users SET identifier_verified=1 WHERE id=?').run(u.id);
    db.prepare('DELETE FROM verification_codes WHERE user_id=?').run(u.id);
    audit(db, u.id, 'auth.identifier_verified', u.id, { ip });
    return { ok: true, verified: true };
  });

  function finishMfa({ db, cfg, body, ip, limiter, setup }) {
    if (!limiter.hit(`mfa-ip:${ip}`, 10, 15 * 60 * 1000)) throw new ApiError(429, 'RATE_LIMITED');
    const token = typeof body.challenge_token === 'string' ? body.challenge_token : '';
    const challenge = db.prepare('SELECT * FROM auth_challenges WHERE token_hash=?').get(S.sha256(token));
    const purpose = setup ? 'admin_mfa_setup' : 'admin_mfa_verify';
    if (!challenge || challenge.purpose !== purpose || challenge.expires_at < now() || challenge.attempts >= 5) throw new ApiError(401, 'MFA_CHALLENGE_INVALID');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(challenge.user_id);
    if (!u || u.role !== 'admin' || u.disabled || (cfg.requireIdentifierVerification && !u.identifier_verified)) throw new ApiError(403, 'FORBIDDEN');
    let secret = null;
    try { secret = setup ? S.decryptSecret(u.mfa_pending_secret, cfg.mfaEncryptionKey) : S.decryptSecret(u.mfa_secret, cfg.mfaEncryptionKey); } catch {}
    if (!secret || !S.verifyTotp(secret, body.code)) {
      db.prepare('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=?').run(challenge.token_hash);
      throw new ApiError(401, 'MFA_CODE_INVALID');
    }
    if (setup) db.prepare('UPDATE users SET mfa_secret=mfa_pending_secret,mfa_pending_secret=NULL,mfa_enabled=1 WHERE id=?').run(u.id);
    db.prepare('DELETE FROM auth_challenges WHERE user_id=?').run(u.id);
    audit(db, u.id, setup ? 'auth.admin_mfa_enabled' : 'auth.admin_mfa_login', u.id, { ip });
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    return { ...startSession(db, cfg, u.id), user: publicUser(updated) };
  }
  r.add('POST', '/api/auth/admin-mfa/setup', { auth: false }, ctx => finishMfa({ ...ctx, setup: true }));
  r.add('POST', '/api/auth/admin-mfa/verify', { auth: false }, ctx => finishMfa({ ...ctx, setup: false }));

  r.add('POST', '/api/auth/logout', { }, ({ db, user, tokenHash, ip }) => {
    db.prepare('UPDATE sessions SET revoked=1 WHERE token_hash=?').run(tokenHash);
    audit(db, user.id, 'auth.logout', user.id, { ip });
    return { ok: true };
  });

  r.add('GET', '/api/auth/me', { }, ({ user }) => ({ user: publicUser(user) }));

  r.add('POST', '/api/auth/password', { }, ({ db, user, body, tokenHash, ip }) => {
    if (!S.verifyPassword(typeof body.current_password === 'string' ? body.current_password : '', user.password_hash)) throw new ApiError(401, 'INVALID_CREDENTIALS');
    checkPassword(body.new_password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(S.hashPassword(body.new_password), user.id);
    // Sign out every other device (shared-device safety).
    db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=? AND token_hash<>?').run(user.id, tokenHash);
    audit(db, user.id, 'auth.password_changed', user.id, { ip });
    return { ok: true };
  });

  // Profile + language preference. Changing language never touches the session or permissions.
  r.add('PUT', '/api/me', { }, ({ db, user, body }) => {
    const sets = [], vals = [];
    if (body.name !== undefined) { sets.push('name=?'); vals.push(V.str(body, 'name', { req: true, max: 80 })); }
    if (body.location !== undefined) { sets.push('location=?'); vals.push(V.str(body, 'location', { max: 120 }) || ''); }
    if (body.skills !== undefined && user.role === 'worker') { sets.push('skills=?'); vals.push(V.str(body, 'skills', { max: 200 }) || ''); }
    if (body.lang !== undefined) {
      const l = i18n.pickLang(body.lang);
      if (!l) throw new ApiError(422, 'LANG_UNSUPPORTED');
      sets.push('lang=?'); vals.push(l);
    }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id=?`).run(...vals, user.id);
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) };
  });
};

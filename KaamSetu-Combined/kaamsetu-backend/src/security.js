'use strict';
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, N, r, p, saltB, hashB] = stored.split('$');
    const expected = Buffer.from(hashB, 'base64');
    const h = crypto.scryptSync(pw, Buffer.from(saltB, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(h, expected);
  } catch { return false; }
}
// Used so that unknown users cost the same time as known users.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

const newToken = () => crypto.randomBytes(32).toString('base64url');
const newOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0; const out = [];
  for (const c of String(input).toUpperCase().replace(/=+$/,'')) { const n = alphabet.indexOf(c); if (n < 0) throw new Error('Invalid base32'); value = (value << 5) | n; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totpCode(secret, time = Date.now()) {
  const counter = Math.floor(time / 30000), msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest(), off = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 1000000; return String(n).padStart(6, '0');
}
function encryptSecret(secret, key) {
  const k = crypto.createHash('sha256').update(String(key || '')).digest();
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function decryptSecret(encrypted, key) {
  const [version, ivB, tagB, dataB] = String(encrypted || '').split('.');
  if (version !== 'v1' || !ivB || !tagB || !dataB) throw new Error('Invalid encrypted secret');
  const k = crypto.createHash('sha256').update(String(key || '')).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
}
function verifyTotp(secret, code, time = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (const step of [-1, 0, 1]) { const expected = totpCode(secret, time + step * 30000); if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return true; }
  return false;
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newId = prefix => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

class RateLimiter {
  // Keep attacker-controlled keys bounded: login identifiers can otherwise create one Map entry per request.
  constructor({ maxEntries = 10000, cleanupEvery = 100 } = {}) {
    this.m = new Map();
    this.maxEntries = maxEntries;
    this.cleanupEvery = cleanupEvery;
    this.hits = 0;
  }
  hit(key, max, windowMs) {
    const now = Date.now();
    this.hits += 1;
    if (this.hits % this.cleanupEvery === 0 || this.m.size >= this.maxEntries) {
      for (const [k, v] of this.m) if (v.reset <= now) this.m.delete(k);
    }
    let e = this.m.get(key);
    if (!e || e.reset <= now) {
      if (!e && this.m.size >= this.maxEntries) {
        // Last-resort bound when a burst creates many unique, still-live keys.
        const oldest = this.m.keys().next();
        if (!oldest.done) this.m.delete(oldest.value);
      }
      e = { count: 0, reset: now + windowMs };
    } else {
      // Refresh insertion order so frequently used buckets are not the first evicted under pressure.
      this.m.delete(key);
    }
    e.count += 1;
    this.m.set(key, e);
    return e.count <= max;
  }
  clear(key) { this.m.delete(key); }
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, newToken, newOtp, newTotpSecret, totpCode, verifyTotp, encryptSecret, decryptSecret, sha256, newId, RateLimiter };

'use strict';
const fs = require('fs');
const path = require('path');
const { ApiError } = require('./errors');
const i18n = require('./i18n');
const { sha256 } = require('./security');
const { now } = require('./db');
const crypto = require('crypto');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, opts, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, pattern, re, keys, opts, handler });
  }
  match(method, p) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(p);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      try { r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); }
      catch { return { route: null, pathMatched: false }; } // malformed %-escape: treat as not found
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > max) { reject(new ApiError(413, 'BODY_TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
        resolve(v);
      } catch { reject(new ApiError(400, 'BAD_JSON')); }
    });
    req.on('error', () => reject(new ApiError(400, 'BAD_JSON')));
  });
}

function authenticate(db, req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer (\S+)$/.exec(h);
  if (!m) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(m[1]));
  if (!s) throw new ApiError(401, 'UNAUTHENTICATED');
  if (s.revoked || s.expires_at < now()) throw new ApiError(401, 'SESSION_EXPIRED');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
  if (user.disabled) throw new ApiError(403, 'ACCOUNT_DISABLED');
  return { user, tokenHash: s.token_hash };
}

const CSP = [
  "default-src 'self'", "script-src 'self'", "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');

function setHeaders(res, cfg, req, isApi) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  if (cfg.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isApi) res.setHeader('Cache-Control', 'no-store'); // never cache personal/financial responses on shared devices
  const origin = req.headers.origin;
  if (origin && cfg.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Language, Accept-Language');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Idempotent-Replay');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function serveStatic(cfg, req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Bad request'); }
  if (rel.includes('\0')) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(path.join(cfg.staticDir, rel));
  if (full !== cfg.staticDir && !full.startsWith(cfg.staticDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const QUIET = new Set(['/api/health', '/api/ready']); // monitors poll these often: log at debug only

function makeHandler({ db, cfg, router, logger, alerter }) {
  return async function handler(req, res) {
    const started = process.hrtime.bigint();
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    const isApi = url.pathname.startsWith('/api/');
    const incoming = String(req.headers['x-request-id'] || '');
    const requestId = /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-Id', requestId);
    let actorId = null, ip = null;
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
      const lvl = QUIET.has(url.pathname) && res.statusCode < 400 ? 'debug' : !isApi ? 'debug' : res.statusCode >= 500 ? 'error'
        : [401, 403, 429].includes(res.statusCode) ? 'warn' : 'info';
      logger[lvl]('request', { id: requestId, method: req.method, path: url.pathname, status: res.statusCode, ms, user: actorId, ip: ip || clientIp(req, cfg) });
    });
    setHeaders(res, cfg, req, isApi);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const method = req.method === 'HEAD' ? 'GET' : req.method; // uptime monitors often use HEAD; Node omits the body automatically
    if (!isApi) {
      if (cfg.staticDir && method === 'GET') return serveStatic(cfg, req, res, url.pathname);
      return send(res, 404, { error: { code: 'NOT_FOUND', message: i18n.translate('en', 'NOT_FOUND') } });
    }

    let lang = i18n.pickLang(url.searchParams.get('lang')) || i18n.pickLang(req.headers['x-language']);
    try {
      const { route, params, pathMatched } = router.match(method, url.pathname);
      if (!route) throw new ApiError(pathMatched ? 405 : 404, pathMatched ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');

      const auth = route.opts.auth === false ? (authenticateOptional(db, req)) : authenticate(db, req);
      if (route.opts.auth !== false) {
        if (!auth) throw new ApiError(401, 'UNAUTHENTICATED');
        if (Array.isArray(route.opts.roles) && !route.opts.roles.includes(auth.user.role)) throw new ApiError(403, 'FORBIDDEN');
      }
      const user = auth ? auth.user : null;
      actorId = user ? user.id : null; ip = clientIp(req, cfg);
      lang = lang || (user && user.lang) || i18n.fromAcceptLanguage(req.headers['accept-language']) || 'en';

      const body = (method === 'GET' || method === 'DELETE') ? {} : await readBody(req, cfg.maxBodyBytes);
      const ctx = { req, res, db, cfg, user, tokenHash: auth && auth.tokenHash, params, query: Object.fromEntries(url.searchParams), body, lang, ip: clientIp(req, cfg), limiter: router.limiter };

      // Idempotent replay for retried POSTs.
      const idemKey = req.method === 'POST' && user ? req.headers['idempotency-key'] : null;
      let sig = null;
      if (idemKey) {
        if (String(idemKey).length > 100) throw new ApiError(422, 'VALIDATION', { field: 'Idempotency-Key' });
        sig = sha256(url.pathname + '\n' + JSON.stringify(body));
        const prev = db.prepare('SELECT * FROM idempotency WHERE key = ? AND user_id = ?').get(idemKey, user.id);
        if (prev) {
          if (prev.request_sig !== sig) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
          res.setHeader('Idempotent-Replay', 'true');
          return send(res, prev.status, JSON.parse(prev.body));
        }
      }

      const out = await route.handler(ctx);
      const status = out && out.__status ? out.__status : 200;
      const payload = out && out.__status ? out.body : (out === undefined ? { ok: true } : out);
      if (idemKey && status < 500) {
        db.prepare('INSERT OR IGNORE INTO idempotency (key, user_id, request_sig, status, body, created_at) VALUES (?,?,?,?,?,?)')
          .run(idemKey, user.id, sig, status, JSON.stringify(payload), now());
      }
      return send(res, status, payload);
    } catch (e) {
      lang = lang || 'en';
      if (e instanceof ApiError) {
        return send(res, e.status, { error: { code: e.code, message: i18n.translate(lang, e.code, e.params), details: e.params, request_id: requestId } });
      }
      if (e && e.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed: bookings/.test(e.message)) {
        return send(res, 409, { error: { code: 'BOOKING_EXISTS', message: i18n.translate(lang, 'BOOKING_EXISTS'), request_id: requestId } });
      }
      // Unexpected failure: full detail goes to the log + alert channel, never to the client.
      logger.error('unhandled_error', { id: requestId, method: req.method, path: url.pathname, err: e });
      alerter.notify('http_500', `Unhandled server error on ${req.method} ${url.pathname} (request ${requestId}): ${e && e.message}`, { request_id: requestId });
      return send(res, 500, { error: { code: 'INTERNAL', message: i18n.translate(lang, 'INTERNAL'), request_id: requestId } });
    }
  };
}

function authenticateOptional(db, req) {
  try { return authenticate(db, req); } catch (e) { if (e instanceof ApiError) return null; throw e; }
}
function clientIp(req, cfg) {
  if (cfg.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

module.exports = { Router, makeHandler };

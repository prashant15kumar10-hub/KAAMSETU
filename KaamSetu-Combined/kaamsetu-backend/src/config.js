'use strict';
const path = require('path');
const pkg = require('../package.json');

function bool(v, d) { return v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()); }
function num(v, d) { return v === undefined || v === '' ? d : Number(v); }

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dbPath = env.DB_PATH || path.join(__dirname, '..', 'data', 'kaamsetu.db');
  // Same-origin production deployments need no CORS origins; the localhost defaults apply to development only.
  const originsRaw = env.ALLOWED_ORIGINS !== undefined ? env.ALLOWED_ORIGINS : (production ? '' : 'http://localhost:8080,http://127.0.0.1:8080');
  return {
    version: pkg.version,
    port: num(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    dbPath,
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 168),
    allowedOrigins: originsRaw.split(',').map(s => s.trim()).filter(Boolean),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : '',
    requireFullTerms: bool(env.REQUIRE_FULL_TERMS, true),
    trustProxy: bool(env.TRUST_PROXY, false),
    production,
    requireIdentifierVerification: bool(env.REQUIRE_IDENTIFIER_VERIFICATION, production),
    requireAdminMfa: bool(env.REQUIRE_ADMIN_MFA, production),
    verificationDeliveryUrl: env.VERIFICATION_DELIVERY_URL || '',
    verificationDeliveryToken: env.VERIFICATION_DELIVERY_TOKEN || '',
    verificationCodeSecret: env.VERIFICATION_CODE_SECRET || '',
    mfaEncryptionKey: env.MFA_ENCRYPTION_KEY || '',
    hsts: bool(env.HSTS, production), // only meaningful when users reach the site over HTTPS
    maxBodyBytes: 64 * 1024,
    rate: { loginMax: 10, loginIpMax: 50, loginWindowMs: 15 * 60 * 1000, registerMax: 20, registerWindowMs: 60 * 60 * 1000 },
    logLevel: env.LOG_LEVEL || 'info',
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
    alertMinIntervalSec: num(env.ALERT_MIN_INTERVAL_SEC, 300),
    maintenanceIntervalMin: num(env.MAINTENANCE_INTERVAL_MIN, 60),
    sessionRetentionDays: num(env.SESSION_RETENTION_DAYS, 7),
    idempotencyRetentionHours: num(env.IDEMPOTENCY_RETENTION_HOURS, 48),
    backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : path.join(path.dirname(dbPath), 'backups'),
    backupIntervalHours: num(env.BACKUP_INTERVAL_HOURS, 0), // 0 = no in-process schedule (use cron/systemd timer instead)
    backupKeep: num(env.BACKUP_KEEP, 14),
  };
}

/* Fail fast on unsafe or nonsensical configuration instead of starting in a bad state. */
function validateConfig(cfg) {
  const errors = [], warnings = [];
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(cfg.port, 1, 65535)) errors.push('PORT must be 1-65535');
  if (!int(cfg.sessionTtlHours, 1, 720)) errors.push('SESSION_TTL_HOURS must be 1-720');
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(cfg.logLevel)) errors.push('LOG_LEVEL must be debug|info|warn|error|silent');
  if (!int(cfg.maintenanceIntervalMin, 0, 1440)) errors.push('MAINTENANCE_INTERVAL_MIN must be 0-1440');
  if (!int(cfg.backupIntervalHours, 0, 720)) errors.push('BACKUP_INTERVAL_HOURS must be 0-720');
  if (!int(cfg.backupKeep, 1, 1000)) errors.push('BACKUP_KEEP must be 1-1000');
  if (!int(cfg.alertMinIntervalSec, 1, 86400)) errors.push('ALERT_MIN_INTERVAL_SEC must be 1-86400');
  if (!int(cfg.sessionRetentionDays, 1, 3650)) errors.push('SESSION_RETENTION_DAYS must be 1-3650');
  if (!int(cfg.idempotencyRetentionHours, 1, 8760)) errors.push('IDEMPOTENCY_RETENTION_HOURS must be 1-8760');
  for (const o of cfg.allowedOrigins) {
    if (o === '*') { errors.push('ALLOWED_ORIGINS must list exact origins, not *'); continue; }
    try { const u = new URL(o); if (u.origin !== o) errors.push(`ALLOWED_ORIGINS entry "${o}" must be an origin without path or trailing slash`); }
    catch { errors.push(`ALLOWED_ORIGINS entry "${o}" is not a valid origin`); }
  }
  if (cfg.alertWebhookUrl) {
    try {
      const u = new URL(cfg.alertWebhookUrl);
      const local = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(cfg.production === false && local)) errors.push('ALERT_WEBHOOK_URL must use https');
    } catch { errors.push('ALERT_WEBHOOK_URL is not a valid URL'); }
  }
  if (cfg.production) {
    if (cfg.requireIdentifierVerification) {
      if (!cfg.verificationDeliveryUrl) errors.push('VERIFICATION_DELIVERY_URL is required when identifier verification is enabled');
      if (cfg.verificationDeliveryToken.length < 24 || /replace-with|change-me|placeholder/i.test(cfg.verificationDeliveryToken)) errors.push('VERIFICATION_DELIVERY_TOKEN must be a real secret of at least 24 characters, not a placeholder');
      if (cfg.verificationCodeSecret.length < 32 || /replace-with|change-me|placeholder/i.test(cfg.verificationCodeSecret)) errors.push('VERIFICATION_CODE_SECRET must be a real secret of at least 32 characters, not a placeholder');
      if (cfg.verificationDeliveryUrl) { try { const deliveryUrl = new URL(cfg.verificationDeliveryUrl); if (deliveryUrl.protocol !== 'https:') errors.push('VERIFICATION_DELIVERY_URL must use https'); if (deliveryUrl.hostname.endsWith('.example') || deliveryUrl.hostname.endsWith('.example.com')) errors.push('VERIFICATION_DELIVERY_URL must point to your real delivery adapter, not an example domain'); } catch { errors.push('VERIFICATION_DELIVERY_URL is invalid'); } }
    }
    if (cfg.requireAdminMfa && (cfg.mfaEncryptionKey.length < 32 || /replace-with|change-me|placeholder/i.test(cfg.mfaEncryptionKey))) errors.push('MFA_ENCRYPTION_KEY must be a real secret of at least 32 characters, not a placeholder');
    if (cfg.requireIdentifierVerification && cfg.requireAdminMfa && cfg.mfaEncryptionKey && cfg.mfaEncryptionKey === cfg.verificationCodeSecret) errors.push('MFA_ENCRYPTION_KEY must be different from VERIFICATION_CODE_SECRET');
    if (!cfg.requireAdminMfa) warnings.push('REQUIRE_ADMIN_MFA=false: admin accounts will not be required to use MFA');
    if (cfg.dbPath === ':memory:') errors.push('DB_PATH must be a file in production');
    if (!cfg.trustProxy) warnings.push('TRUST_PROXY=false: behind a reverse proxy every visitor shares one IP, so login rate limits would hit all users together. Set TRUST_PROXY=true only if a trusted proxy is in front.');
    if (cfg.allowedOrigins.some(o => /localhost|127\.0\.0\.1/.test(o))) warnings.push('ALLOWED_ORIGINS contains localhost in production');
    if (!cfg.alertWebhookUrl) warnings.push('ALERT_WEBHOOK_URL is not set: server errors are logged but nobody is notified');
    if (!cfg.backupIntervalHours) warnings.push('BACKUP_INTERVAL_HOURS=0: make sure an external schedule runs `npm run backup`');
  }
  return { errors, warnings };
}
module.exports = { loadConfig, validateConfig };

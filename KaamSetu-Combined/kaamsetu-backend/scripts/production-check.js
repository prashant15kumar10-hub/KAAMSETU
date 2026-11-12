'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, validateConfig } = require('../src/config');
const cfg = loadConfig();
let failed = false;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}
check('NODE_ENV is production', cfg.production, `current=${process.env.NODE_ENV || '(unset)'}`);
const validation = validateConfig(cfg);
for (const error of validation.errors) check(`config: ${error}`, false);
for (const warning of validation.warnings) console.warn(`WARN ${warning}`);
check('identifier verification enabled', cfg.requireIdentifierVerification);
check('admin MFA required', cfg.requireAdminMfa);
check('delivery provider configured', !!(cfg.verificationDeliveryUrl && cfg.verificationDeliveryToken && cfg.verificationDeliveryToken.length >= 24));
check('verification secret has 32+ characters', cfg.verificationCodeSecret.length >= 32 && !/replace-with|change-me|placeholder/i.test(cfg.verificationCodeSecret));
check('MFA encryption key has 32+ non-placeholder characters', cfg.mfaEncryptionKey.length >= 32 && !/replace-with|change-me|placeholder/i.test(cfg.mfaEncryptionKey));
check('verification and MFA secrets are distinct', !cfg.mfaEncryptionKey || cfg.mfaEncryptionKey !== cfg.verificationCodeSecret);
check('exact CORS origin allowlist (no wildcard)', !cfg.allowedOrigins.includes('*'));
const isolatedContainer = String(process.env.DEPLOYMENT_NETWORK_ISOLATED || '').toLowerCase() === 'true';
check('server is not publicly exposed except through reverse proxy', ['127.0.0.1', '::1', 'localhost'].includes(cfg.host) || (cfg.host === '0.0.0.0' && isolatedContainer), `HOST=${cfg.host}, isolated-container=${isolatedContainer}`);
if (cfg.staticDir) check('static frontend index exists', fs.existsSync(path.join(cfg.staticDir, 'index.html')), cfg.staticDir);
else check('static frontend configured', false, 'set STATIC_DIR for the combined deployment');
if (cfg.dbPath !== ':memory:' && fs.existsSync(cfg.dbPath)) {
  if (process.platform !== 'win32') {
    const mode = fs.statSync(cfg.dbPath).mode & 0o777;
    check('database file is not group/world accessible', (mode & 0o077) === 0, `mode=${mode.toString(8).padStart(3, '0')}`);
  } else console.warn('SKIP database POSIX permissions check on Windows; verify ACLs on the production host.');
} else console.warn('WARN database file does not exist yet; check permissions after first startup.');
console.log('\nMANUAL REQUIRED: verify live DNS/TLS certificate renewal, cloud firewall/security groups, host patching, secret-manager access, backup restore, and external penetration-test results. This script cannot inspect those remote controls.');
process.exitCode = failed ? 1 : 0;

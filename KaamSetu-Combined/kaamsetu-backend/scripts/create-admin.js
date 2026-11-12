'use strict';
// Usage: ADMIN_IDENTIFIER=admin@example.com ADMIN_PASSWORD='long-secret' ADMIN_NAME='Support' npm run create-admin
const { loadConfig } = require('../src/config');
const { openDb, now } = require('../src/db');
const S = require('../src/security');

const id = (process.env.ADMIN_IDENTIFIER || '').trim().toLowerCase();
const pw = process.env.ADMIN_PASSWORD || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(id) || pw.length < 12) {
  console.error('Set ADMIN_IDENTIFIER (an email) and ADMIN_PASSWORD (at least 12 characters).'); process.exit(1);
}
const db = openDb(loadConfig().dbPath);
if (db.prepare('SELECT 1 FROM users WHERE identifier=?').get(id)) { console.error('An account with that identifier already exists.'); process.exit(1); }
db.prepare(`INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, lang, created_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run(S.newId('u'), id, 'email', process.env.ADMIN_NAME || 'Admin', 'admin', S.hashPassword(pw), 'en', now());
console.log('Admin created:', id);

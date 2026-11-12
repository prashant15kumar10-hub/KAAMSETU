'use strict';
// Verified online backup + retention: npm run backup   (dir: BACKUP_DIR or <db folder>/backups, keeps BACKUP_KEEP newest)
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { backupDatabase, pruneBackups } = require('../src/backup');
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
try {
  const out = backupDatabase(db, cfg.backupDir);
  const removed = pruneBackups(cfg.backupDir, cfg.backupKeep);
  console.log('Backup written and verified:', out);
  if (removed.length) console.log('Old backups removed:', removed.length);
  console.log('A backup on the same disk does NOT protect against losing the disk: copy it off the server too (see docs/OPERATIONS.md).');
} catch (e) { console.error('BACKUP FAILED:', e.message); process.exitCode = 1; } finally { db.close(); }

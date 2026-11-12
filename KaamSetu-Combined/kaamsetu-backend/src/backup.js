'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function verifyDbFile(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ic = db.prepare('PRAGMA integrity_check').all();
    if (ic.length !== 1 || ic[0].integrity_check !== 'ok') throw new Error('integrity_check failed');
    const mig = db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
    if (!mig) throw new Error('no schema_migrations rows (not a KAAMSETU database?)');
    return { migrations: mig };
  } finally { db.close(); }
}

/* Consistent online backup using VACUUM INTO, then verified by reopening it. A backup that fails verification is deleted. */
function backupDatabase(db, dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') { try { fs.chmodSync(dir, 0o700); } catch {} }
  const out = path.join(dir, `kaamsetu-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  if (process.platform !== 'win32') { try { fs.chmodSync(out, 0o600); } catch {} }
  try { verifyDbFile(out); } catch (e) { try { fs.unlinkSync(out); } catch {} throw new Error('backup verification failed: ' + e.message); }
  return out;
}

/* Keep the newest `keep` backups (names sort chronologically). Returns the removed file names. */
function pruneBackups(dir, keep) {
  if (!keep || keep < 1) return [];
  const files = fs.readdirSync(dir).filter(f => /^kaamsetu-.*\.db$/.test(f)).sort();
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return old;
}

/* Restore a verified backup over dbPath. The SERVER MUST BE STOPPED first. The current database is kept as
   <db>.pre-restore-<time> so a mistaken restore can be undone. */
function restoreBackup(backupFile, dbPath) {
  const src = path.resolve(backupFile), dst = path.resolve(dbPath);
  if (src === dst) throw new Error('backup file and database path are the same file');
  verifyDbFile(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let savedAs = null;
  if (fs.existsSync(dst)) {
    savedAs = `${dst}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(dst, savedAs);
    if (process.platform !== 'win32') { try { fs.chmodSync(savedAs, 0o600); } catch {} }
  }
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(dst + ext); } catch {} }
  const tmp = dst + '.restoring';
  fs.copyFileSync(src, tmp);
  if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o600); } catch {} }
  fs.renameSync(tmp, dst);
  verifyDbFile(dst);
  return { restoredFrom: src, previousDatabaseSavedAs: savedAs };
}

function startBackupScheduler(db, cfg, { logger, alerter }) {
  if (!cfg.backupIntervalHours) return { stop() {} };
  const run = () => {
    try { const f = backupDatabase(db, cfg.backupDir); const removed = pruneBackups(cfg.backupDir, cfg.backupKeep); logger.info('backup_done', { file: path.basename(f), pruned: removed.length }); }
    catch (e) { logger.error('backup_failed', { err: e }); alerter.notify('backup_failed', 'Scheduled database backup FAILED: ' + (e && e.message)); }
  };
  const h = setInterval(run, cfg.backupIntervalHours * 3600e3); h.unref();
  setTimeout(run, 30e3).unref(); // first backup shortly after start
  return { stop() { clearInterval(h); } };
}
module.exports = { backupDatabase, pruneBackups, restoreBackup, verifyDbFile, startBackupScheduler };

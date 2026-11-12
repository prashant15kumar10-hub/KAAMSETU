'use strict';
// Restore: STOP THE SERVER FIRST, then:  npm run restore -- path/to/kaamsetu-<time>.db --yes
const { loadConfig } = require('../src/config');
const { restoreBackup } = require('../src/backup');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file || !args.includes('--yes')) {
  console.error('Usage: npm run restore -- <backup-file.db> --yes\nStop the server first. The current database is saved as <db>.pre-restore-<time>.');
  process.exit(2);
}
try {
  const cfg = loadConfig();
  const r = restoreBackup(file, cfg.dbPath);
  console.log('Restored from:', r.restoredFrom);
  if (r.previousDatabaseSavedAs) console.log('Previous database kept at:', r.previousDatabaseSavedAs);
  console.log('Now start the server and check /api/ready.');
} catch (e) { console.error('RESTORE FAILED (nothing was overwritten unless stated above):', e.message); process.exit(1); }

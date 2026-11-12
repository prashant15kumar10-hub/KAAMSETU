'use strict';
/* Structured JSON logging (one line per event) for log shippers / `docker logs` / journald.
   Only explicitly passed fields are written. Request bodies, Authorization headers, passwords and
   tokens are never passed to the logger, so they cannot leak into logs. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger({ level = 'info', write } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const out = write || ((line, lvl) => (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n'));
  function log(lvl, msg, fields) {
    if (LEVELS[lvl] < min) return;
    const rec = { ts: new Date().toISOString(), level: lvl, msg, ...(fields || {}) };
    if (rec.err instanceof Error) rec.err = { name: rec.err.name, message: rec.err.message, stack: rec.err.stack };
    let line;
    try { line = JSON.stringify(rec); } catch { line = JSON.stringify({ ts: rec.ts, level: lvl, msg, note: 'unserializable_fields' }); }
    out(line, lvl);
  }
  return { debug: (m, f) => log('debug', m, f), info: (m, f) => log('info', m, f), warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f), level };
}
module.exports = { createLogger, LEVELS };

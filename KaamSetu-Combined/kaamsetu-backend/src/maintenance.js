'use strict';
/* Routine housekeeping. Removes only data that has no record-keeping value:
   expired/revoked sessions and old idempotency replay entries. The audit log, bookings, payments and their event
   histories are NEVER purged here (retention of those is a business/legal decision). */
function runMaintenance(db, cfg, nowMs = Date.now()) {
  const sessCut = new Date(nowMs - cfg.sessionRetentionDays * 86400e3).toISOString();
  const idemCut = new Date(nowMs - cfg.idempotencyRetentionHours * 3600e3).toISOString();
  const s = db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked = 1 AND created_at < ?)').run(sessCut, sessCut);
  const i = db.prepare('DELETE FROM idempotency WHERE created_at < ?').run(idemCut);
  try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* in-memory or no WAL */ }
  return { sessions_removed: Number(s.changes), idempotency_removed: Number(i.changes) };
}

function startMaintenance(db, cfg, { logger, alerter }) {
  const tick = () => {
    try { const r = runMaintenance(db, cfg); logger.info('maintenance_done', r); }
    catch (e) { logger.error('maintenance_failed', { err: e }); alerter.notify('maintenance_failed', 'Routine maintenance failed: ' + (e && e.message)); }
  };
  tick();
  if (!cfg.maintenanceIntervalMin) return { stop() {} };
  const h = setInterval(tick, cfg.maintenanceIntervalMin * 60e3); h.unref();
  return { stop() { clearInterval(h); } };
}
module.exports = { runMaintenance, startMaintenance };

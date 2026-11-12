'use strict';
const { loadConfig, validateConfig } = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createLogger } = require('./logger');
const { createAlerter } = require('./alerts');
const { startMaintenance } = require('./maintenance');
const { startBackupScheduler } = require('./backup');

const cfg = loadConfig();
const logger = createLogger({ level: cfg.logLevel });
const { errors, warnings } = validateConfig(cfg);
for (const w of warnings) logger.warn('config_warning', { warning: w });
if (errors.length) { for (const e of errors) logger.error('config_error', { error: e }); process.exit(1); }

const alerter = createAlerter({ url: cfg.alertWebhookUrl, minIntervalSec: cfg.alertMinIntervalSec, logger });
const db = openDb(cfg.dbPath);
const server = createApp(db, cfg, { logger, alerter });
const maintenance = startMaintenance(db, cfg, { logger, alerter });
const backups = startBackupScheduler(db, cfg, { logger, alerter });

server.listen(cfg.port, cfg.host, () => {
  logger.info('server_started', { url: `http://${cfg.host}:${cfg.port}`, version: cfg.version, production: cfg.production, db: cfg.dbPath,
    static_dir: cfg.staticDir || null, alerts_configured: alerter.enabled, backup_every_hours: cfg.backupIntervalHours });
});

let stopping = false;
const stop = (why) => {
  if (stopping) return; stopping = true;
  logger.info('server_stopping', { why });
  maintenance.stop(); backups.stop();
  server.close(() => { try { db.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));

// A crash must be visible: log it, try to alert, then exit so the supervisor (Docker/systemd) restarts a clean process.
const fatal = (kind) => async (err) => {
  logger.error('fatal', { kind, err: err instanceof Error ? err : new Error(String(err)) });
  await Promise.race([alerter.notify('fatal', `Server crashed (${kind}): ${err && err.message}`), new Promise(r => setTimeout(r, 3000))]);
  process.exit(1);
};
process.on('uncaughtException', fatal('uncaughtException')); process.on('unhandledRejection', fatal('unhandledRejection'));

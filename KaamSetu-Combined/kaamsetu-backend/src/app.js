'use strict';
const http = require('http');
const { Router, makeHandler } = require('./http');
const { RateLimiter } = require('./security');
const { createLogger } = require('./logger');
const { createAlerter } = require('./alerts');

function createApp(db, cfg, deps = {}) {
  const logger = deps.logger || createLogger({ level: cfg.logLevel });
  const alerter = deps.alerter || createAlerter({ url: cfg.alertWebhookUrl, minIntervalSec: cfg.alertMinIntervalSec, logger });
  const router = new Router();
  router.limiter = new RateLimiter();
  for (const m of ['meta', 'auth', 'jobs', 'bookings', 'payments', 'help', 'admin']) require(`./routes/${m}`)(router);
  const handler = makeHandler({ db, cfg, router, logger, alerter });
  const server = http.createServer((req, res) => {
    handler(req, res).catch(e => {
      logger.error('handler_crash', { err: e });
      alerter.notify('handler_crash', 'Request handler crashed: ' + (e && e.message));
      try { res.writeHead(500); res.end(); } catch {}
    });
  });
  // Slow-client protection (slowloris): bounded time for headers, whole request and idle connections.
  server.headersTimeout = 15000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000;
  server.router = router; server.logger = logger; server.alerter = alerter;
  return server;
}
module.exports = { createApp };

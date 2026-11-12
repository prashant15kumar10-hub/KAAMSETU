'use strict';
// Sends one test alert to ALERT_WEBHOOK_URL so you can confirm the channel works:  npm run test-alert
const { loadConfig, validateConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { createAlerter } = require('../src/alerts');
const cfg = loadConfig();
const { errors } = validateConfig(cfg);
if (errors.length) { console.error('Config errors:', errors.join('; ')); process.exit(1); }
if (!cfg.alertWebhookUrl) { console.error('ALERT_WEBHOOK_URL is not set.'); process.exit(1); }
createAlerter({ url: cfg.alertWebhookUrl, minIntervalSec: 1, logger: createLogger({ level: 'silent' }) })
  .notify('test_alert', 'This is a test alert from the KAAMSETU server. If you can read it, alerts work.')
  .then(ok => { console.log(ok ? 'Test alert delivered (HTTP 2xx from the webhook).' : 'Test alert NOT delivered - check the URL and the provider.'); process.exit(ok ? 0 : 1); });

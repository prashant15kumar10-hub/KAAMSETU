'use strict';
/* Optional error alerts via a generic JSON webhook (ALERT_WEBHOOK_URL).
   Sends {text, content, service, key, time, details}: `text` suits Slack-style incoming webhooks and `content`
   suits Discord-style ones; automation tools (n8n, Zapier, Make) can read any field. No webhook is configured by default,
   in which case alerts are only logged. Alerts are throttled per key so an outage cannot flood the channel.
   Alerts never include request bodies, tokens or user identifiers. */
function createAlerter({ url, minIntervalSec = 300, logger, fetchImpl = (...a) => fetch(...a), service = 'kaamsetu' } = {}) {
  const last = new Map(); const suppressed = new Map();
  async function notify(key, text, details = {}) {
    const nowMs = Date.now();
    const prev = last.get(key);
    if (prev && nowMs - prev < minIntervalSec * 1000) { suppressed.set(key, (suppressed.get(key) || 0) + 1); return false; }
    last.set(key, nowMs);
    const skipped = suppressed.get(key) || 0; suppressed.delete(key);
    logger && logger.error('alert', { key, text, suppressed_since_last: skipped });
    if (!url) return false;
    const body = { text: `[${service}] ${text}`, content: `[${service}] ${text}`, service, key, time: new Date(nowMs).toISOString(),
      details: { ...details, suppressed_since_last: skipped } };
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (!res.ok) { logger && logger.warn('alert_delivery_failed', { key, status: res.status }); return false; }
      return true;
    } catch (e) { logger && logger.warn('alert_delivery_failed', { key, reason: e && e.name }); return false; }
  }
  return { notify, enabled: !!url };
}
module.exports = { createAlerter };

'use strict';
const { bad } = require('./errors');

const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

function str(b, k, { req = false, max = 200 } = {}) {
  let v = b[k];
  if (v === undefined || v === null) { if (req) throw bad(k, 'required'); return undefined; }
  if (typeof v !== 'string') throw bad(k, 'invalid');
  v = clean(v);
  if (!v) { if (req) throw bad(k, 'required'); return ''; }
  if (v.length > max) throw bad(k, 'too_long');
  return v;
}
// Accepts numbers or digit strings (the frontend form sends strings).
function int(b, k, { req = false, min = 1, max = 1e9 } = {}) {
  let v = b[k];
  if (v === undefined || v === null || v === '') { if (req) throw bad(k, 'required'); return undefined; }
  if (typeof v === 'string' && /^\d{1,12}$/.test(v.trim())) v = parseInt(v.trim(), 10);
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(k, 'invalid');
  return v;
}
function date(b, k, { req = false } = {}) {
  const v = str(b, k, { req, max: 10 });
  if (v === undefined || v === '') return v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(k, 'invalid');
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(k, 'invalid');
  return v;
}
function time(b, k, { req = false } = {}) {
  const v = str(b, k, { req, max: 5 });
  if (v === undefined || v === '') return v;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(k, 'invalid');
  return v;
}
function oneOf(b, k, list, { req = false } = {}) {
  const v = str(b, k, { req, max: 40 });
  if (v === undefined) return v;
  if (!list.includes(v)) throw bad(k, 'invalid');
  return v;
}
// "Today" in India (IST, UTC+5:30), as YYYY-MM-DD.
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

module.exports = { str, int, date, time, oneOf, todayIST, clean };

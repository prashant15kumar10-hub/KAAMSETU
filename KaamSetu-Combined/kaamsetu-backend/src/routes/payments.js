'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const S = require('../security');
const { now, tx } = require('../db');
const { serializePayment, paymentEvent, paymentSummary } = require('../services');

const METHODS = ['cash', 'upi', 'bank', 'other'];

function loadPayment(db, id) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(p.booking_id);
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(b.job_id);
  return { p, b, j };
}
const canSee = (u, b, j) => u.role === 'admin' || b.worker_id === u.id || j.contractor_id === u.id;

module.exports = function (r) {
  // Contractor REPORTS a payment. This is a statement - not proof that money moved.
  r.add('POST', '/api/bookings/:id/payments', { roles: ['contractor'] }, ({ db, user, params, body }) => {
    const amount = V.int(body, 'amount', { req: true, min: 1, max: 1000000 });
    const paidOn = V.date(body, 'paid_on') || V.todayIST();
    if (paidOn > V.todayIST()) throw new ApiError(422, 'VALIDATION', { field: 'paid_on', reason: 'future' });
    const method = V.oneOf(body, 'method', METHODS) || 'other';
    const note = V.str(body, 'note', { max: 300 }) || '';
    const id = tx(db, () => {
      const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(params.id);
      const j = b && db.prepare('SELECT * FROM jobs WHERE id=?').get(b.job_id);
      if (!b || j.contractor_id !== user.id) throw new ApiError(404, 'BOOKING_NOT_FOUND');
      const pid = S.newId('p'); const t = now();
      db.prepare("INSERT INTO payments (id, booking_id, amount, paid_on, method, note, reported_by, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(pid, b.id, amount, paidOn, method, note, user.id, 'reported', t, t);
      paymentEvent(db, pid, user.id, 'reported', { amount, method, paid_on: paidOn });
      return pid;
    });
    return { __status: 201, body: { payment: serializePayment(db, db.prepare('SELECT * FROM payments WHERE id=?').get(id)) } };
  });

  // Role-scoped payment history. Worker: own. Contractor: for own jobs. Superseded rows hidden unless ?include_superseded=1.
  r.add('GET', '/api/payments', { roles: ['worker', 'contractor'] }, ({ db, user, query }) => {
    const base = user.role === 'worker'
      ? 'SELECT p.* FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.worker_id=?'
      : 'SELECT p.* FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN jobs j ON j.id=b.job_id WHERE j.contractor_id=?';
    const rows = db.prepare(base + ' ORDER BY p.created_at DESC').all(user.id)
      .filter(p => (query.status ? p.status === query.status : (query.include_superseded === '1' || p.status !== 'superseded')));
    return { payments: rows.map(p => serializePayment(db, p)) };
  });

  r.add('GET', '/api/payments/:id', { }, ({ db, user, params }) => {
    const { p, b, j } = loadPayment(db, params.id);
    if (!canSee(user, b, j)) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
    const events = db.prepare('SELECT event, detail, created_at FROM payment_events WHERE payment_id=? ORDER BY id').all(p.id)
      .map(e => ({ ...e, detail: JSON.parse(e.detail) }));
    return { payment: serializePayment(db, p), history: events, summary: paymentSummary(db, b, j) };
  });

  r.add('POST', '/api/payments/:id/acknowledge', { roles: ['worker'] }, ({ db, user, params }) => {
    tx(db, () => {
      const { p, b } = loadPayment(db, params.id);
      if (b.worker_id !== user.id) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
      if (p.status !== 'reported') throw new ApiError(409, 'PAYMENT_STATE_INVALID');
      db.prepare("UPDATE payments SET status='acknowledged', updated_at=? WHERE id=?").run(now(), p.id);
      paymentEvent(db, p.id, user.id, 'acknowledged');
    });
    return { payment: serializePayment(db, db.prepare('SELECT * FROM payments WHERE id=?').get(params.id)) };
  });

  // Worker challenges an incorrect report (allowed even after acknowledging, in case of a mistaken tap).
  r.add('POST', '/api/payments/:id/dispute', { roles: ['worker'] }, ({ db, user, params, body }) => {
    const reason = V.str(body, 'reason', { max: 500 });
    if (!reason) throw new ApiError(422, 'DISPUTE_REASON_REQUIRED');
    tx(db, () => {
      const { p, b } = loadPayment(db, params.id);
      if (b.worker_id !== user.id) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
      if (p.status !== 'reported' && p.status !== 'acknowledged') throw new ApiError(409, 'PAYMENT_STATE_INVALID');
      db.prepare("UPDATE payments SET status='disputed', dispute_reason=?, updated_at=? WHERE id=?").run(reason, now(), p.id);
      paymentEvent(db, p.id, user.id, 'disputed', { reason, previous_status: p.status });
    });
    return { payment: serializePayment(db, db.prepare('SELECT * FROM payments WHERE id=?').get(params.id)) };
  });

  // Contractor responds to a dispute with their side (kept in history; does not change the status).
  r.add('POST', '/api/payments/:id/respond', { roles: ['contractor'] }, ({ db, user, params, body }) => {
    const message = V.str(body, 'message', { req: true, max: 500 });
    tx(db, () => {
      const { p, j } = loadPayment(db, params.id);
      if (j.contractor_id !== user.id) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
      if (p.status !== 'disputed') throw new ApiError(409, 'PAYMENT_STATE_INVALID');
      paymentEvent(db, p.id, user.id, 'contractor_response', { message });
    });
    return { ok: true };
  });

  // Correct a report: the old row becomes 'superseded' (kept), a new 'reported' row is created.
  // An acknowledged payment cannot be unilaterally rewritten by the contractor.
  r.add('POST', '/api/payments/:id/correct', { roles: ['contractor'] }, ({ db, user, params, body }) => {
    const amount = V.int(body, 'amount', { req: true, min: 1, max: 1000000 });
    const paidOn = V.date(body, 'paid_on');
    const method = V.oneOf(body, 'method', METHODS);
    const note = V.str(body, 'note', { max: 300 });
    const reason = V.str(body, 'reason', { req: true, max: 300 });
    const newId = tx(db, () => {
      const { p, j } = loadPayment(db, params.id);
      if (j.contractor_id !== user.id) throw new ApiError(404, 'PAYMENT_NOT_FOUND');
      if (p.status !== 'reported' && p.status !== 'disputed') throw new ApiError(409, 'PAYMENT_STATE_INVALID');
      const pd = paidOn || p.paid_on;
      if (pd > V.todayIST()) throw new ApiError(422, 'VALIDATION', { field: 'paid_on', reason: 'future' });
      const nid = S.newId('p'); const t = now();
      db.prepare("UPDATE payments SET status='superseded', updated_at=? WHERE id=?").run(t, p.id);
      db.prepare("INSERT INTO payments (id, booking_id, amount, paid_on, method, note, reported_by, status, corrects_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(nid, p.booking_id, amount, pd, method || p.method, note ?? p.note, user.id, 'reported', p.id, t, t);
      paymentEvent(db, p.id, user.id, 'superseded', { by: nid, reason });
      paymentEvent(db, nid, user.id, 'reported', { amount, corrects: p.id, reason });
      return nid;
    });
    return { __status: 201, body: { payment: serializePayment(db, db.prepare('SELECT * FROM payments WHERE id=?').get(newId)) } };
  });
};

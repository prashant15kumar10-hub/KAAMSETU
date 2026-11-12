'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const S = require('../security');
const { now, tx } = require('../db');
const { serializeJob, arrivalState, paymentSummary, bookingEvent } = require('../services');
const { activeCount } = require('./jobs');

function loadBooking(db, id) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b) throw new ApiError(404, 'BOOKING_NOT_FOUND');
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(b.job_id);
  return { b, j };
}
// Only the worker, the job's contractor, or an admin may see a booking. Others get 404 (no existence leak).
function participantOrNotFound(user, b, j) {
  const ok = user.role === 'admin' || b.worker_id === user.id || j.contractor_id === user.id;
  if (!ok) throw new ApiError(404, 'BOOKING_NOT_FOUND');
}

module.exports = function (r) {
  // Worker accepts a job. Requires explicit terms acceptance for the CURRENT terms version.
  r.add('POST', '/api/jobs/:id/accept', { roles: ['worker'] }, ({ db, user, params, body }) => {
    if (body.accept_terms !== true) throw new ApiError(422, 'TERMS_NOT_ACCEPTED');
    const tv = V.int(body, 'terms_version', { req: true, min: 1, max: 1e6 });
    const bid = tx(db, () => {
      const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(params.id);
      if (!j || (j.status !== 'open')) throw new ApiError(404, 'JOB_NOT_FOUND');
      if (tv !== j.terms_version) throw new ApiError(409, 'TERMS_VERSION_MISMATCH', { current_terms_version: j.terms_version });
      if (j.date < V.todayIST()) throw new ApiError(422, 'JOB_DATE_PAST');
      const existing = db.prepare('SELECT * FROM bookings WHERE job_id=? AND worker_id=?').get(j.id, user.id);
      if (existing && existing.status === 'confirmed') throw new ApiError(409, 'BOOKING_EXISTS');
      if (existing && existing.status === 'cancelled_by_contractor') throw new ApiError(409, 'BOOKING_EXISTS');
      // Capacity check counts every other active/held booking. Runs inside an IMMEDIATE transaction => no overbooking races.
      const others = db.prepare("SELECT COUNT(*) n FROM bookings WHERE job_id=? AND worker_id<>? AND status IN ('confirmed','needs_reacceptance')").get(j.id, user.id).n;
      if (others >= j.needed) throw new ApiError(409, 'JOB_FULL');
      const t = now();
      if (existing) {
        db.prepare("UPDATE bookings SET status='confirmed', accepted_terms_version=?, accepted_at=?, cancelled_at=NULL, cancel_reason='' WHERE id=?").run(tv, t, existing.id);
        bookingEvent(db, existing.id, user.id, existing.status === 'needs_reacceptance' ? 'terms_reaccepted' : 'accepted_again', { terms_version: tv });
        return existing.id;
      }
      const id = S.newId('b');
      db.prepare("INSERT INTO bookings (id, job_id, worker_id, status, accepted_terms_version, accepted_at, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, j.id, user.id, 'confirmed', tv, t, t);
      bookingEvent(db, id, user.id, 'accepted', { terms_version: tv });
      return id;
    });
    const { b, j } = loadBooking(db, bid);
    return { __status: 201, body: { booking: { id: b.id, status: b.status, accepted_terms_version: b.accepted_terms_version, arrival_state: arrivalState(db, b.id) },
      job: serializeJob(db, j, user), note_code: 'CONFIRMATION_IS_NOT_GUARANTEED_ATTENDANCE' } };
  });

  // Worker's bookings ("Today's work").
  r.add('GET', '/api/my/bookings', { roles: ['worker'] }, ({ db, user, query }) => {
    const rows = db.prepare("SELECT * FROM bookings WHERE worker_id=? ORDER BY created_at DESC").all(user.id)
      .filter(b => !query.status || b.status === query.status);
    return { bookings: rows.map(b => {
      const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(b.job_id);
      return { id: b.id, status: b.status, accepted_terms_version: b.accepted_terms_version, arrival_state: arrivalState(db, b.id),
        needs_reacceptance: b.status === 'needs_reacceptance', job: serializeJob(db, j, user) };
    }) };
  });

  r.add('GET', '/api/bookings/:id', { }, ({ db, user, params }) => {
    const { b, j } = loadBooking(db, params.id);
    participantOrNotFound(user, b, j);
    const att = db.prepare('SELECT work_date, status, source, created_at FROM attendance WHERE booking_id=? ORDER BY work_date, source').all(b.id);
    const events = db.prepare('SELECT event, detail, created_at FROM booking_events WHERE booking_id=? ORDER BY id').all(b.id)
      .map(e => ({ ...e, detail: JSON.parse(e.detail) }));
    return { booking: { id: b.id, status: b.status, accepted_terms_version: b.accepted_terms_version, arrival_state: arrivalState(db, b.id), cancel_reason: b.cancel_reason },
      job: serializeJob(db, j, user), attendance: att.map(a => ({ ...a, verified: false })), history: events, payment_summary: paymentSummary(db, b, j) };
  });

  // Cancel by worker (own booking) or by the job's contractor. No compensation is calculated (policy not approved).
  r.add('POST', '/api/bookings/:id/cancel', { roles: ['worker', 'contractor'] }, ({ db, user, params, body }) => {
    const reason = V.str(body, 'reason', { max: 300 }) || '';
    const { b, j } = tx(db, () => {
      const x = loadBooking(db, params.id);
      const isWorker = user.role === 'worker' && x.b.worker_id === user.id;
      const isOwner = user.role === 'contractor' && x.j.contractor_id === user.id;
      if (!isWorker && !isOwner) throw new ApiError(404, 'BOOKING_NOT_FOUND');
      if (x.b.status !== 'confirmed' && x.b.status !== 'needs_reacceptance') throw new ApiError(409, 'BOOKING_NOT_ACTIVE');
      const st = isWorker ? 'cancelled_by_worker' : 'cancelled_by_contractor';
      db.prepare('UPDATE bookings SET status=?, cancelled_at=?, cancel_reason=? WHERE id=?').run(st, now(), reason, x.b.id);
      bookingEvent(db, x.b.id, user.id, st, { reason });
      return loadBooking(db, x.b.id);
    });
    return { booking: { id: b.id, status: b.status }, job: serializeJob(db, j, user),
      compensation: { calculated: false, reason_code: 'COMPENSATION_POLICY_NOT_APPROVED' } };
  });

  // Attendance. Contractor records arrived/absent; worker may only self-report arrival.
  // Neither is independently verified (no GPS or provider) - responses say so.
  r.add('POST', '/api/bookings/:id/attendance', { roles: ['worker', 'contractor'] }, ({ db, user, params, body }) => {
    const out = tx(db, () => {
      const { b, j } = loadBooking(db, params.id);
      const isWorker = user.role === 'worker' && b.worker_id === user.id;
      const isOwner = user.role === 'contractor' && j.contractor_id === user.id;
      if (!isWorker && !isOwner) throw new ApiError(404, 'BOOKING_NOT_FOUND');
      if (b.status !== 'confirmed') throw new ApiError(409, 'BOOKING_NOT_ACTIVE');
      const workDate = V.date(body, 'work_date') || V.todayIST();
      if (workDate > V.todayIST() || workDate < j.date) throw new ApiError(422, 'ATTENDANCE_DATE_INVALID');
      const status = V.oneOf(body, 'status', ['arrived', 'absent']) || 'arrived';
      const source = isOwner ? 'contractor' : 'worker_self';
      if (isWorker && status !== 'arrived') throw new ApiError(403, 'FORBIDDEN');
      const prev = db.prepare('SELECT * FROM attendance WHERE booking_id=? AND work_date=? AND source=?').get(b.id, workDate, source);
      if (prev && source === 'worker_self') throw new ApiError(409, 'ATTENDANCE_EXISTS');
      if (prev) {
        if (prev.status !== status) {
          db.prepare('UPDATE attendance SET status=?, recorded_by=? WHERE id=?').run(status, user.id, prev.id);
          bookingEvent(db, b.id, user.id, 'attendance_corrected', { work_date: workDate, from: prev.status, to: status });
        }
      } else {
        db.prepare('INSERT INTO attendance (booking_id, work_date, status, source, recorded_by, created_at) VALUES (?,?,?,?,?,?)').run(b.id, workDate, status, source, user.id, now());
        bookingEvent(db, b.id, user.id, source === 'contractor' ? 'attendance_recorded' : 'arrival_self_reported', { work_date: workDate, status });
      }
      return { b, j, workDate, status, source };
    });
    return { __status: 201, body: { booking_id: out.b.id, work_date: out.workDate, status: out.status, source: out.source, verified: false,
      arrival_state: arrivalState(db, out.b.id), job: serializeJob(db, out.j, user) } };
  });
};

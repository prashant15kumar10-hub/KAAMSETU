'use strict';
const { now } = require('./db');

const TERM_FIELDS = ['title', 'skill', 'wage', 'location', 'date', 'time', 'duration', 'hours', 'equipment', 'paytime', 'cancel'];
const ACTIVE = "('confirmed','needs_reacceptance')";

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, lang: u.lang, identifier: u.identifier, identifier_type: u.identifier_type,
    identifier_verified: !!u.identifier_verified, skills_self_declared: u.skills, location: u.location };
}

function jobCounts(db, jobId) {
  const c = sql => db.prepare(sql).get(jobId).n;
  return {
    confirmed: c("SELECT COUNT(*) n FROM bookings WHERE job_id=? AND status='confirmed'"),
    awaiting_reacceptance: c("SELECT COUNT(*) n FROM bookings WHERE job_id=? AND status='needs_reacceptance'"),
    cancelled: c("SELECT COUNT(*) n FROM bookings WHERE job_id=? AND status IN ('cancelled_by_worker','cancelled_by_contractor')"),
    // confirmed but the contractor has recorded nothing yet (confirmation is NOT guaranteed attendance)
    pending: c(`SELECT COUNT(*) n FROM bookings b WHERE b.job_id=? AND b.status='confirmed'
                AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.booking_id=b.id AND a.source='contractor')`),
    arrived: c(`SELECT COUNT(*) n FROM bookings b WHERE b.job_id=? AND b.status='confirmed'
                AND EXISTS (SELECT 1 FROM attendance a WHERE a.booking_id=b.id AND a.source='contractor' AND a.status='arrived')`),
  };
}

function serializeJob(db, j, viewer) {
  const contractor = db.prepare('SELECT name FROM users WHERE id=?').get(j.contractor_id);
  const out = {
    id: j.id, title: j.title, skill: j.skill, wage: j.wage, wage_basis: 'per_day', location: j.location,
    date: j.date, time: j.time, duration: j.duration, hours: j.hours, equipment: j.equipment, paytime: j.paytime, cancel: j.cancel,
    needed: j.needed, status: j.status, terms_version: j.terms_version, source_job_id: j.source_job_id,
    contractor: { name: contractor ? contractor.name : '' },
    created_at: j.created_at, published_at: j.published_at,
    ...jobCounts(db, j.id),
  };
  if (viewer && viewer.role === 'worker') {
    const b = db.prepare('SELECT id, status, accepted_terms_version FROM bookings WHERE job_id=? AND worker_id=?').get(j.id, viewer.id);
    out.my_booking = b ? { id: b.id, status: b.status, accepted_terms_version: b.accepted_terms_version } : null;
  }
  return out;
}

function arrivalState(db, bookingId) {
  const rows = db.prepare('SELECT status, source FROM attendance WHERE booking_id=?').all(bookingId);
  if (rows.some(r => r.source === 'contractor' && r.status === 'arrived')) return 'recorded_arrived';
  if (rows.some(r => r.source === 'contractor' && r.status === 'absent')) return 'recorded_absent';
  if (rows.some(r => r.source === 'worker_self')) return 'self_reported_arrived'; // not verified
  return 'arrival_pending';
}

/* Keeps agreed wage, recorded work, owed, reported, acknowledged and disputed amounts SEPARATE.
   None of these is bank-verified settlement; no payment provider is integrated. */
function paymentSummary(db, booking, job) {
  const days = db.prepare("SELECT COUNT(*) n FROM attendance WHERE booking_id=? AND source='contractor' AND status='arrived'").get(booking.id).n;
  const sum = st => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id=? AND status=?').get(booking.id, st).s;
  const earned = (job.wage || 0) * days;
  const reported = sum('reported'), acknowledged = sum('acknowledged'), disputed = sum('disputed');
  const diff = earned - reported - acknowledged;
  return {
    agreed_daily_wage: job.wage, days_recorded_by_contractor: days, earned_wages: earned,
    reported_by_contractor_unacknowledged: reported, acknowledged_by_worker: acknowledged,
    disputed_by_worker: disputed, // not subtracted from owed until resolved
    amount_owed: Math.max(0, diff), reported_more_than_earned: Math.max(0, -diff),
    provider_verified_settlement: null, // no payment provider integrated
    notes: ['payments_are_recorded_statements_not_bank_proof'],
  };
}

function bookingEvent(db, bookingId, actorId, event, detail = {}) {
  db.prepare('INSERT INTO booking_events (booking_id, actor_id, event, detail, created_at) VALUES (?,?,?,?,?)')
    .run(bookingId, actorId, event, JSON.stringify(detail), now());
}
function paymentEvent(db, paymentId, actorId, event, detail = {}) {
  db.prepare('INSERT INTO payment_events (payment_id, actor_id, event, detail, created_at) VALUES (?,?,?,?,?)')
    .run(paymentId, actorId, event, JSON.stringify(detail), now());
}
function audit(db, actorId, action, target, detail = {}) {
  db.prepare('INSERT INTO audit_log (actor_id, action, target, detail, created_at) VALUES (?,?,?,?,?)')
    .run(actorId, action, target, JSON.stringify(detail), now());
}

const STATUS_KEY = { reported: 'status_reported', acknowledged: 'status_ack', disputed: 'status_disputed', superseded: 'status_superseded' };

function serializePayment(db, p) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(p.booking_id);
  const j = db.prepare('SELECT id, title, contractor_id FROM jobs WHERE id=?').get(b.job_id);
  const w = db.prepare('SELECT id, name FROM users WHERE id=?').get(b.worker_id);
  const c = db.prepare('SELECT name FROM users WHERE id=?').get(j.contractor_id);
  return {
    id: p.id, booking_id: p.booking_id, job_id: j.id, job_title: j.title,
    worker: { id: w.id, name: w.name }, contractor: { name: c.name },
    amount: p.amount, paid_on: p.paid_on, method: p.method, note: p.note,
    status: p.status, status_key: STATUS_KEY[p.status], dispute_reason: p.dispute_reason,
    corrects_id: p.corrects_id, reported_by_role: 'contractor', verified_by_provider: false,
    created_at: p.created_at, updated_at: p.updated_at,
  };
}

module.exports = { TERM_FIELDS, ACTIVE, publicUser, jobCounts, serializeJob, arrivalState, paymentSummary,
  bookingEvent, paymentEvent, audit, serializePayment };

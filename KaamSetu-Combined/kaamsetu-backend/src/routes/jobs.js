'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const S = require('../security');
const { now, tx } = require('../db');
const { TERM_FIELDS, serializeJob, bookingEvent, audit } = require('../services');

const REQUIRED_BASIC = ['title', 'skill', 'wage', 'location', 'date', 'time'];
const REQUIRED_TERMS = ['duration', 'hours', 'equipment', 'paytime', 'cancel'];
const LIMITS = { title: 100, skill: 100, location: 200, duration: 100, hours: 200, equipment: 200, paytime: 200, cancel: 500 };

// Parse only the fields present in the request body.
function parseJobFields(body) {
  const f = {};
  for (const k of ['title', 'skill', 'location', 'duration', 'hours', 'equipment', 'paytime', 'cancel']) {
    const v = V.str(body, k, { max: LIMITS[k] }); if (v !== undefined) f[k] = v;
  }
  const wage = V.int(body, 'wage', { min: 1, max: 100000 }); if (wage !== undefined) f.wage = wage;
  const date = V.date(body, 'date'); if (date !== undefined) f.date = date;
  const time = V.time(body, 'time'); if (time !== undefined) f.time = time;
  const needed = V.int(body, 'needed', { min: 1, max: 100 }); if (needed !== undefined) f.needed = needed;
  return f;
}
function missingFields(job, cfg) {
  const req = cfg.requireFullTerms ? [...REQUIRED_BASIC, ...REQUIRED_TERMS] : REQUIRED_BASIC;
  return req.filter(k => job[k] === null || job[k] === undefined || job[k] === '');
}
function ownedJob(db, id, user) {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  if (!j || j.contractor_id !== user.id) throw new ApiError(404, 'JOB_NOT_FOUND'); // do not reveal other contractors' drafts
  return j;
}
function assertPublishable(job, cfg, body) {
  if (body.confirm_reviewed !== true) throw new ApiError(422, 'REVIEW_REQUIRED');
  const miss = missingFields(job, cfg);
  if (miss.length) throw new ApiError(422, 'JOB_FIELDS_MISSING', { fields: miss.join(', ') });
  if (job.date < V.todayIST()) throw new ApiError(422, 'JOB_DATE_PAST');
}
function activeCount(db, jobId) {
  return db.prepare("SELECT COUNT(*) n FROM bookings WHERE job_id=? AND status IN ('confirmed','needs_reacceptance')").get(jobId).n;
}
function insertJob(db, userId, f, extra = {}) {
  const id = S.newId('j'); const t = now();
  db.prepare(`INSERT INTO jobs (id, contractor_id, title, skill, wage, location, date, time, duration, hours, equipment, paytime, cancel, needed, status, source_job_id, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, f.title || '', f.skill || '', f.wage ?? null, f.location || '', f.date || '', f.time || '', f.duration || '', f.hours || '',
      f.equipment || '', f.paytime || '', f.cancel || '', f.needed ?? 3, 'draft', extra.source_job_id || null, t, t);
  return id;
}
function publish(db, id) {
  db.prepare("UPDATE jobs SET status='open', published_at=?, updated_at=? WHERE id=?").run(now(), now(), id);
}

module.exports = function (r) {
  // Create a draft (or draft + publish in one call when publish:true and confirm_reviewed:true).
  r.add('POST', '/api/jobs', { roles: ['contractor'] }, ({ db, cfg, user, body }) => {
    const f = parseJobFields(body);
    if (!f.title) throw new ApiError(422, 'VALIDATION', { field: 'title', reason: 'required' });
    const id = tx(db, () => {
      const jid = insertJob(db, user.id, f);
      if (body.publish === true) { assertPublishable(db.prepare('SELECT * FROM jobs WHERE id=?').get(jid), cfg, body); publish(db, jid); }
      return jid;
    });
    return { __status: 201, body: { job: serializeJob(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(id), user) } };
  });

  // Browse open jobs (workers). Contractors list their own via /api/my/jobs.
  r.add('GET', '/api/jobs', { roles: ['worker', 'contractor', 'admin'] }, ({ db, user, query }) => {
    const where = ["j.status='open'"]; const vals = [];
    if (query.q) { where.push('(j.title LIKE ? OR j.skill LIKE ? OR j.location LIKE ?)'); const p = `%${String(query.q).slice(0, 60)}%`; vals.push(p, p, p); }
    if (query.date) { where.push('j.date = ?'); vals.push(String(query.date).slice(0, 10)); }
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
    const rows = db.prepare(`SELECT j.* FROM jobs j WHERE ${where.join(' AND ')} ORDER BY j.date ASC, j.time ASC LIMIT ? OFFSET ?`).all(...vals, limit, offset);
    return { jobs: rows.map(j => serializeJob(db, j, user)), limit, offset };
  });

  r.add('GET', '/api/my/jobs', { roles: ['contractor'] }, ({ db, user, query }) => {
    const rows = query.status
      ? db.prepare('SELECT * FROM jobs WHERE contractor_id=? AND status=? ORDER BY date DESC, created_at DESC').all(user.id, String(query.status))
      : db.prepare('SELECT * FROM jobs WHERE contractor_id=? ORDER BY date DESC, created_at DESC').all(user.id);
    return { jobs: rows.map(j => serializeJob(db, j, user)) };
  });

  r.add('GET', '/api/jobs/:id', { }, ({ db, user, params }) => {
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(params.id);
    if (!j) throw new ApiError(404, 'JOB_NOT_FOUND');
    const isOwner = j.contractor_id === user.id;
    const hasBooking = user.role === 'worker' && db.prepare('SELECT 1 FROM bookings WHERE job_id=? AND worker_id=?').get(j.id, user.id);
    if (j.status === 'draft' && !isOwner) throw new ApiError(404, 'JOB_NOT_FOUND');
    if (j.status !== 'open' && !isOwner && !hasBooking && user.role !== 'admin') throw new ApiError(404, 'JOB_NOT_FOUND');
    return { job: serializeJob(db, j, user) };
  });

  // Edit. On a published job, any change to the agreed terms bumps terms_version and
  // moves existing confirmed workers to "needs_reacceptance" - no one is silently held to new terms.
  r.add('PATCH', '/api/jobs/:id', { roles: ['contractor'] }, ({ db, user, params, body }) => {
    const out = tx(db, () => {
      const j = ownedJob(db, params.id, user);
      if (j.status !== 'draft' && j.status !== 'open') throw new ApiError(409, 'JOB_NOT_OPEN');
      const f = parseJobFields(body);
      if (f.needed !== undefined && j.status === 'open' && f.needed < activeCount(db, j.id)) throw new ApiError(422, 'NEEDED_BELOW_ACTIVE');
      const changedTerms = TERM_FIELDS.filter(k => f[k] !== undefined && String(f[k]) !== String(j[k] ?? ''));
      const keys = Object.keys(f);
      if (!keys.length) return { job: j, changed: false };
      if (j.status === 'open' && f.date !== undefined && f.date < V.todayIST()) throw new ApiError(422, 'JOB_DATE_PAST');
      const sets = keys.map(k => `${k}=?`);
      let version = j.terms_version;
      if (j.status === 'open' && changedTerms.length) version += 1;
      db.prepare(`UPDATE jobs SET ${sets.join(', ')}, terms_version=?, updated_at=? WHERE id=?`).run(...keys.map(k => f[k]), version, now(), j.id);
      if (version !== j.terms_version) {
        const affected = db.prepare("SELECT id FROM bookings WHERE job_id=? AND status='confirmed'").all(j.id);
        db.prepare("UPDATE bookings SET status='needs_reacceptance' WHERE job_id=? AND status='confirmed'").run(j.id);
        for (const b of affected) bookingEvent(db, b.id, user.id, 'terms_changed', { fields: changedTerms, new_version: version });
      }
      return { job: db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id), changed: version !== j.terms_version };
    });
    return { job: serializeJob(db, out.job, user), terms_changed: out.changed };
  });

  r.add('POST', '/api/jobs/:id/publish', { roles: ['contractor'] }, ({ db, cfg, user, params, body }) => {
    const j = tx(db, () => {
      const job = ownedJob(db, params.id, user);
      if (job.status !== 'draft') throw new ApiError(409, 'JOB_NOT_DRAFT');
      assertPublishable(job, cfg, body);
      publish(db, job.id);
      return db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
    });
    return { job: serializeJob(db, j, user) };
  });

  // "Repeat this job": copies DETAILS ONLY into a NEW draft. Never copies workers, attendance or payments.
  // Date is cleared and the draft must be reviewed and explicitly confirmed before it can be published.
  r.add('POST', '/api/jobs/:id/repeat', { roles: ['contractor'] }, ({ db, user, params }) => {
    const src = ownedJob(db, params.id, user);
    const id = tx(db, () => insertJob(db, user.id,
      { title: src.title, skill: src.skill, wage: src.wage, location: src.location, date: '', time: src.time, duration: src.duration,
        hours: src.hours, equipment: src.equipment, paytime: src.paytime, cancel: src.cancel, needed: src.needed },
      { source_job_id: src.id }));
    return { __status: 201, body: { job: serializeJob(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(id), user),
      review_required: ['date', 'wage', 'location', 'terms'] } };
  });

  r.add('POST', '/api/jobs/:id/cancel', { roles: ['contractor'] }, ({ db, user, params, body }) => {
    const reason = V.str(body, 'reason', { max: 300 }) || '';
    const res = tx(db, () => {
      const j = ownedJob(db, params.id, user);
      if (j.status !== 'open' && j.status !== 'draft') throw new ApiError(409, 'JOB_NOT_OPEN');
      db.prepare("UPDATE jobs SET status='cancelled', updated_at=? WHERE id=?").run(now(), j.id);
      const bs = db.prepare("SELECT id FROM bookings WHERE job_id=? AND status IN ('confirmed','needs_reacceptance')").all(j.id);
      db.prepare("UPDATE bookings SET status='cancelled_by_contractor', cancelled_at=?, cancel_reason=? WHERE job_id=? AND status IN ('confirmed','needs_reacceptance')")
        .run(now(), reason, j.id);
      for (const b of bs) bookingEvent(db, b.id, user.id, 'job_cancelled_by_contractor', { reason });
      audit(db, user.id, 'job.cancel', j.id, { affected_bookings: bs.length });
      return { j: db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id), n: bs.length };
    });
    return { job: serializeJob(db, res.j, user), cancelled_bookings: res.n, compensation: { calculated: false, reason_code: 'COMPENSATION_POLICY_NOT_APPROVED' } };
  });

  r.add('POST', '/api/jobs/:id/close', { roles: ['contractor'] }, ({ db, user, params }) => {
    const j = tx(db, () => {
      const job = ownedJob(db, params.id, user);
      if (job.status !== 'open') throw new ApiError(409, 'JOB_NOT_OPEN');
      db.prepare("UPDATE jobs SET status='closed', updated_at=? WHERE id=?").run(now(), job.id);
      return db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
    });
    return { job: serializeJob(db, j, user) };
  });

  // Contractor's team for a job ("Today's team"), including per-worker arrival state.
  r.add('GET', '/api/jobs/:id/bookings', { roles: ['contractor'] }, ({ db, user, params }) => {
    const { arrivalState } = require('../services');
    const j = ownedJob(db, params.id, user);
    const rows = db.prepare(`SELECT b.*, u.name worker_name, u.skills worker_skills FROM bookings b JOIN users u ON u.id=b.worker_id
                             WHERE b.job_id=? ORDER BY b.created_at`).all(j.id);
    return { job_id: j.id, bookings: rows.map(b => ({
      id: b.id, status: b.status, worker: { id: b.worker_id, name: b.worker_name, skills_self_declared: b.worker_skills },
      accepted_terms_version: b.accepted_terms_version, accepted_at: b.accepted_at, arrival_state: arrivalState(db, b.id), cancel_reason: b.cancel_reason,
    })) };
  });
};
module.exports.activeCount = activeCount;

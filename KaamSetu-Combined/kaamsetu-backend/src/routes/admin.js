'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const { now } = require('../db');
const { publicUser, serializePayment, audit } = require('../services');

/* Admin accounts are created ONLY via `npm run create-admin` (never by self-registration).
   Admins can view and triage; they cannot change payment records, bookings or job terms. */
module.exports = function (r) {
  const A = { roles: ['admin'] };

  r.add('GET', '/api/admin/users', A, ({ db, query }) => {
    const rows = query.role ? db.prepare('SELECT * FROM users WHERE role=? ORDER BY created_at DESC LIMIT 200').all(String(query.role))
      : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();
    return { users: rows.map(u => ({ ...publicUser(u), disabled: !!u.disabled, created_at: u.created_at })) };
  });

  r.add('PATCH', '/api/admin/users/:id', A, ({ db, user, params, body }) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
    if (!u) throw new ApiError(404, 'NOT_FOUND');
    if (u.id === user.id) throw new ApiError(403, 'FORBIDDEN'); // cannot lock yourself out
    if (typeof body.disabled !== 'boolean') throw new ApiError(422, 'VALIDATION', { field: 'disabled' });
    db.prepare('UPDATE users SET disabled=? WHERE id=?').run(body.disabled ? 1 : 0, u.id);
    if (body.disabled) db.prepare('UPDATE sessions SET revoked=1 WHERE user_id=?').run(u.id);
    audit(db, user.id, body.disabled ? 'user.disable' : 'user.enable', u.id);
    return { ok: true };
  });

  r.add('GET', '/api/admin/help', A, ({ db, query }) => {
    const rows = db.prepare(`SELECT h.*, u.name user_name, u.role user_role FROM help_requests h JOIN users u ON u.id=h.user_id
                             ${query.status ? 'WHERE h.status=?' : ''} ORDER BY h.created_at DESC LIMIT 200`).all(...(query.status ? [String(query.status)] : []));
    return { help: rows };
  });

  r.add('PATCH', '/api/admin/help/:id', A, ({ db, user, params, body }) => {
    const h = db.prepare('SELECT * FROM help_requests WHERE id=?').get(params.id);
    if (!h) throw new ApiError(404, 'NOT_FOUND');
    const status = V.oneOf(body, 'status', ['open', 'in_progress', 'resolved']) || h.status;
    const response = V.str(body, 'response', { max: 1000 });
    db.prepare('UPDATE help_requests SET status=?, response=?, updated_at=? WHERE id=?').run(status, response ?? h.response, now(), h.id);
    audit(db, user.id, 'help.update', h.id, { status });
    return { ok: true };
  });

  // Disputed payments for review. Admin triage is NOT claimed to be an independent adjudication.
  r.add('GET', '/api/admin/payments', A, ({ db, query }) => {
    const rows = db.prepare('SELECT * FROM payments WHERE status=? ORDER BY updated_at DESC LIMIT 200').all(String(query.status || 'disputed'));
    return { payments: rows.map(p => serializePayment(db, p)) };
  });

  r.add('GET', '/api/admin/audit', A, ({ db }) => ({
    audit: db.prepare('SELECT id, actor_id, action, target, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 200').all(),
  }));
};

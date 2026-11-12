'use strict';
const { ApiError } = require('../errors');
const V = require('../validate');
const S = require('../security');
const { now } = require('../db');

const CATEGORIES = ['payment', 'booking', 'account', 'other'];

module.exports = function (r) {
  // ORDINARY help only. These messages are readable by platform admins and are NOT confidential.
  r.add('POST', '/api/help', { roles: ['worker', 'contractor'] }, ({ db, user, body }) => {
    if (body.category === 'safety') throw new ApiError(422, 'SAFETY_REPORTING_NOT_ENABLED');
    const category = V.oneOf(body, 'category', CATEGORIES, { req: true });
    const message = V.str(body, 'message', { req: true, max: 1000 });
    const id = S.newId('h'); const t = now();
    db.prepare('INSERT INTO help_requests (id, user_id, category, message, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(id, user.id, category, message, t, t);
    return { __status: 201, body: { help: { id, category, message, status: 'open', created_at: t }, visible_to: 'platform_admins', confidential: false } };
  });

  r.add('GET', '/api/help', { roles: ['worker', 'contractor'] }, ({ db, user }) => ({
    help: db.prepare('SELECT id, category, message, status, response, created_at, updated_at FROM help_requests WHERE user_id=? ORDER BY created_at DESC').all(user.id),
  }));
};

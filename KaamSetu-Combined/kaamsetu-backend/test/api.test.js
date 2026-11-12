'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('auth, roles, language and session handling', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { call } = s;

  await t.test('register validates input and never allows admin self-registration', async () => {
    assert.equal((await call('POST', '/api/auth/register', { body: { identifier: 'abc', password: 'Passw0rd!x', name: 'A', role: 'worker' } })).body.error.code, 'IDENTIFIER_INVALID');
    assert.equal((await call('POST', '/api/auth/register', { body: { identifier: '9876543210', password: 'short', name: 'A', role: 'worker' } })).body.error.code, 'PASSWORD_WEAK');
    const r = await call('POST', '/api/auth/register', { body: { identifier: '9876543210', password: 'Passw0rd!x', name: 'A', role: 'admin' } });
    assert.equal(r.status, 422); assert.equal(r.body.error.code, 'ROLE_INVALID');
  });

  await t.test('register + duplicate identifier (phone formats normalize)', async () => {
    assert.equal((await call('POST', '/api/auth/register', { body: { identifier: '+91 98765-43210', password: 'Passw0rd!x', name: 'Ram', role: 'worker' } })).status, 201);
    const d = await call('POST', '/api/auth/register', { body: { identifier: '9876543210', password: 'Passw0rd!x', name: 'Ram2', role: 'worker' } });
    assert.equal(d.status, 409); assert.equal(d.body.error.code, 'IDENTIFIER_TAKEN');
  });

  await t.test('login errors are generic; password hash never leaks', async () => {
    const bad = await call('POST', '/api/auth/login', { body: { identifier: '9876543210', password: 'wrong-pass' } });
    const none = await call('POST', '/api/auth/login', { body: { identifier: '9123456780', password: 'wrong-pass' } });
    assert.equal(bad.status, 401); assert.equal(bad.body.error.code, none.body.error.code);
    const ok = await call('POST', '/api/auth/login', { body: { identifier: '9876543210', password: 'Passw0rd!x' } });
    assert.equal(ok.status, 200); assert.ok(!JSON.stringify(ok.body).includes('scrypt'));
  });

  await t.test('localized error messages: Hindi by ?lang, X-Language, user preference; stable code always', async () => {
    const hi = await call('GET', '/api/auth/me?lang=hi');
    assert.equal(hi.body.error.code, 'UNAUTHENTICATED'); assert.match(hi.body.error.message, /लॉगिन/);
    const en = await call('GET', '/api/auth/me', { headers: { 'X-Language': 'en' } });
    assert.equal(en.body.error.message, 'Please log in to continue.');
    const w = await s.register('9111111111', 'worker');
    assert.equal((await call('PUT', '/api/me', { token: w.token, body: { lang: 'hi' } })).body.user.lang, 'hi');
    const afterPref = await call('GET', '/api/jobs/nope', { token: w.token });
    assert.equal(afterPref.body.error.code, 'JOB_NOT_FOUND'); assert.match(afterPref.body.error.message, /काम नहीं मिला/);
    assert.equal((await call('PUT', '/api/me', { token: w.token, body: { lang: 'ta' } })).body.error.code, 'LANG_UNSUPPORTED');
    // switching language does not end the session
    assert.equal((await call('GET', '/api/auth/me', { token: w.token })).status, 200);
  });

  await t.test('messages catalog exists for both languages with identical codes', async () => {
    const a = (await call('GET', '/api/messages?lang=en')).body.messages, b = (await call('GET', '/api/messages?lang=hi')).body.messages;
    assert.deepEqual(Object.keys(a), Object.keys(b));
    for (const k of Object.keys(b)) assert.ok(b[k] && b[k].length > 0, k);
  });

  await t.test('logout revokes the token; expired sessions say SESSION_EXPIRED', async () => {
    const u = await s.register('9222222222', 'worker');
    assert.equal((await call('POST', '/api/auth/logout', { token: u.token })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).body.error.code, 'SESSION_EXPIRED');
    const v = await s.register('9333333333', 'worker');
    s.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(v.id);
    assert.equal((await call('GET', '/api/auth/me', { token: v.token })).body.error.code, 'SESSION_EXPIRED');
    assert.equal((await call('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
  });

  await t.test('password change signs out other devices', async () => {
    const reg = await call('POST', '/api/auth/register', { body: { identifier: 'pw@example.com', password: 'Passw0rd!x', name: 'PW', role: 'contractor' } });
    const other = (await call('POST', '/api/auth/login', { body: { identifier: 'pw@example.com', password: 'Passw0rd!x' } })).body.token;
    assert.equal((await call('POST', '/api/auth/password', { token: reg.body.token, body: { current_password: 'Passw0rd!x', new_password: 'NewPassw0rd!y' } })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: other })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: reg.body.token })).status, 200);
  });

  await t.test('login rate limiting', async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login', { body: { identifier: 'rate@example.com', password: 'nope-nope' } });
    assert.equal(last.status, 429); assert.equal(last.body.error.code, 'RATE_LIMITED');
  });

  await t.test('bad JSON, oversized body, unknown route, wrong method', async () => {
    const raw = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(raw.status, 400);
    const big = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal((await call('GET', '/api/nothing')).status, 404);
    assert.equal((await call('DELETE', '/api/health')).status, 405);
  });
});

test('login rate limiting applies across unique identifiers from one IP', async (t) => {
  const s = await startServer({ rate: { loginMax: 10, loginIpMax: 2, loginWindowMs: 60000, registerMax: 20, registerWindowMs: 60000 } }); t.after(s.close);
  const first = await s.call('POST', '/api/auth/login', { body: { identifier: 'one@example.com', password: 'wrong-password' } });
  const second = await s.call('POST', '/api/auth/login', { body: { identifier: 'two@example.com', password: 'wrong-password' } });
  const third = await s.call('POST', '/api/auth/login', { body: { identifier: 'three@example.com', password: 'wrong-password' } });
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 429, 'changing the identifier must not bypass the IP-wide limit');
});

test('jobs: drafts, publish gate, repeat-as-new-draft, role separation', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { call } = s;
  const c = await s.register('c1@example.com', 'contractor', 'Suresh');
  const c2 = await s.register('c2@example.com', 'contractor', 'Other');
  const w = await s.register('9444444444', 'worker', 'Ramesh');

  await t.test('workers cannot post jobs; contractors cannot accept jobs', async () => {
    assert.equal((await call('POST', '/api/jobs', { token: w.token, body: s.fullJob() })).status, 403);
    const j = (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true }) })).body.job;
    assert.equal((await call('POST', `/api/jobs/${j.id}/accept`, { token: c.token, body: { accept_terms: true, terms_version: 1 } })).status, 403);
  });

  await t.test('publish requires review confirmation, complete terms and a non-past date', async () => {
    assert.equal((await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true }) })).body.error.code, 'REVIEW_REQUIRED');
    const miss = await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true, cancel: '' }) });
    assert.equal(miss.body.error.code, 'JOB_FIELDS_MISSING'); assert.match(miss.body.error.details.fields, /cancel/);
    assert.equal((await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true, date: '2020-01-01' }) })).body.error.code, 'JOB_DATE_PAST');
    assert.equal((await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ wage: 'abc' }) })).body.error.code, 'VALIDATION');
  });

  await t.test('drafts are private; open jobs are visible to workers with counts', async () => {
    const d = (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob() })).body.job;
    assert.equal(d.status, 'draft');
    assert.equal((await call('GET', `/api/jobs/${d.id}`, { token: c2.token })).status, 404);
    assert.equal((await call('GET', `/api/jobs/${d.id}`, { token: w.token })).status, 404);
    assert.equal((await call('POST', `/api/jobs/${d.id}/publish`, { token: c2.token, body: { confirm_reviewed: true } })).status, 404);
    assert.equal((await call('POST', `/api/jobs/${d.id}/publish`, { token: c.token, body: { confirm_reviewed: true } })).body.job.status, 'open');
    const list = await call('GET', '/api/jobs', { token: w.token });
    const j = list.body.jobs.find(x => x.id === d.id);
    assert.deepEqual([j.needed, j.confirmed, j.cancelled, j.pending], [2, 0, 0, 0]);
    assert.equal((await call('POST', `/api/jobs/${d.id}/publish`, { token: c.token, body: { confirm_reviewed: true } })).body.error.code, 'JOB_NOT_DRAFT');
  });

  await t.test('repeat copies details only into a NEW draft: no workers, no payments, date cleared', async () => {
    const src = (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true }) })).body.job;
    const wk = await s.register('9555555555', 'worker');
    const acc = await call('POST', `/api/jobs/${src.id}/accept`, { token: wk.token, body: { accept_terms: true, terms_version: 1 } });
    await call('POST', `/api/bookings/${acc.body.booking.id}/payments`, { token: c.token, body: { amount: 500 } });
    const rep = await call('POST', `/api/jobs/${src.id}/repeat`, { token: c.token });
    assert.equal(rep.status, 201);
    const n = rep.body.job;
    assert.notEqual(n.id, src.id); assert.equal(n.status, 'draft'); assert.equal(n.date, ''); assert.equal(n.source_job_id, src.id);
    assert.equal(n.wage, src.wage); assert.equal(n.confirmed, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM bookings WHERE job_id=?').get(n.id).n, 0);
    // cannot publish without choosing a new date and confirming review
    assert.equal((await call('POST', `/api/jobs/${n.id}/publish`, { token: c.token, body: { confirm_reviewed: true } })).body.error.code, 'JOB_FIELDS_MISSING');
    assert.equal((await call('PATCH', `/api/jobs/${n.id}`, { token: c.token, body: { date: s.tomorrow() } })).status, 200);
    assert.equal((await call('POST', `/api/jobs/${n.id}/publish`, { token: c.token, body: {} })).body.error.code, 'REVIEW_REQUIRED');
    assert.equal((await call('POST', `/api/jobs/${n.id}/publish`, { token: c.token, body: { confirm_reviewed: true } })).status, 200);
    // another contractor cannot repeat my job
    assert.equal((await call('POST', `/api/jobs/${src.id}/repeat`, { token: c2.token })).status, 404);
  });

  await t.test('only the owner can edit/cancel/list team', async () => {
    const j = (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true }) })).body.job;
    assert.equal((await call('PATCH', `/api/jobs/${j.id}`, { token: c2.token, body: { wage: 1 } })).status, 404);
    assert.equal((await call('GET', `/api/jobs/${j.id}/bookings`, { token: c2.token })).status, 404);
    assert.equal((await call('GET', `/api/jobs/${j.id}/bookings`, { token: w.token })).status, 403);
    assert.equal((await call('POST', `/api/jobs/${j.id}/cancel`, { token: c2.token })).status, 404);
  });
});

test('bookings: terms acceptance, capacity, duplicates, terms change, cancellation, attendance', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { call } = s;
  const c = await s.register('boss@example.com', 'contractor', 'Boss');
  const w1 = await s.register('9600000001', 'worker', 'W1'), w2 = await s.register('9600000002', 'worker', 'W2'), w3 = await s.register('9600000003', 'worker', 'W3');
  const job = async (over = {}) => (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ publish: true, confirm_reviewed: true, ...over }) })).body.job;
  const accept = (w, j, body = { accept_terms: true, terms_version: j.terms_version }) => call('POST', `/api/jobs/${j.id}/accept`, { token: w.token, body });

  await t.test('explicit terms acceptance required, with current version', async () => {
    const j = await job();
    assert.equal((await accept(w1, j, { terms_version: 1 })).body.error.code, 'TERMS_NOT_ACCEPTED');
    assert.equal((await accept(w1, j, { accept_terms: 'yes', terms_version: 1 })).body.error.code, 'TERMS_NOT_ACCEPTED');
    assert.equal((await accept(w1, j, { accept_terms: true, terms_version: 9 })).body.error.code, 'TERMS_VERSION_MISMATCH');
    const ok = await accept(w1, j);
    assert.equal(ok.status, 201); assert.equal(ok.body.note_code, 'CONFIRMATION_IS_NOT_GUARANTEED_ATTENDANCE');
    assert.equal(ok.body.booking.arrival_state, 'arrival_pending');
  });

  await t.test('duplicate booking blocked; capacity enforced; concurrent accepts never overbook', async () => {
    const j = await job({ needed: 2 });
    assert.equal((await accept(w1, j)).status, 201);
    assert.equal((await accept(w1, j)).body.error.code, 'BOOKING_EXISTS');
    const extra = await Promise.all(Array.from({ length: 5 }, async (_, i) => (await s.register('961000000' + i, 'worker')).token));
    const results = await Promise.all(extra.map(tok => accept({ token: tok }, j)));
    assert.equal(results.filter(r => r.status === 201).length, 1); // 1 seat left
    assert.equal(results.filter(r => r.body && r.body.error && r.body.error.code === 'JOB_FULL').length, 4);
    const counts = (await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job;
    assert.equal(counts.confirmed, 2); assert.equal(counts.needed, 2);
  });

  await t.test('changing terms forces fresh acceptance; seat is held; stale acceptance rejected', async () => {
    const j = await job({ needed: 2 });
    const b = (await accept(w1, j)).body.booking;
    const p = await call('PATCH', `/api/jobs/${j.id}`, { token: c.token, body: { wage: 700 } });
    assert.equal(p.body.terms_changed, true); assert.equal(p.body.job.terms_version, 2); assert.equal(p.body.job.awaiting_reacceptance, 1); assert.equal(p.body.job.confirmed, 0);
    assert.equal((await call('GET', '/api/my/bookings', { token: w1.token })).body.bookings.find(x => x.id === b.id).needs_reacceptance, true);
    assert.equal((await accept(w1, j, { accept_terms: true, terms_version: 1 })).body.error.code, 'TERMS_VERSION_MISMATCH');
    assert.equal((await accept(w1, { id: j.id, terms_version: 2 })).status, 201);
    assert.equal((await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job.confirmed, 1);
    // same values => no bump
    const same = await call('PATCH', `/api/jobs/${j.id}`, { token: c.token, body: { wage: 700 } });
    assert.equal(same.body.terms_changed, false);
    // cannot lower needed below booked
    assert.equal((await accept(w2, { id: j.id, terms_version: 2 })).status, 201);
    assert.equal((await call('PATCH', `/api/jobs/${j.id}`, { token: c.token, body: { needed: 1 } })).body.error.code, 'NEEDED_BELOW_ACTIVE');
  });

  await t.test('worker cancel frees the seat and allows re-accept; cancel permissions enforced', async () => {
    const j = await job({ needed: 1 });
    const b = (await accept(w1, j)).body.booking;
    assert.equal((await accept(w2, j)).body.error.code, 'JOB_FULL');
    assert.equal((await call('POST', `/api/bookings/${b.id}/cancel`, { token: w2.token })).status, 404);
    const cx = await call('POST', `/api/bookings/${b.id}/cancel`, { token: w1.token, body: { reason: 'ill' } });
    assert.equal(cx.body.booking.status, 'cancelled_by_worker'); assert.equal(cx.body.compensation.calculated, false);
    assert.equal((await call('POST', `/api/bookings/${b.id}/cancel`, { token: w1.token })).body.error.code, 'BOOKING_NOT_ACTIVE');
    assert.equal((await accept(w2, j)).status, 201);
    assert.equal((await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job.cancelled, 1);
  });

  await t.test('attendance: contractor-recorded vs worker self-report (unverified); counts reflect it', async () => {
    const j = await job({ needed: 2 });
    const b1 = (await accept(w1, j)).body.booking, b2 = (await accept(w2, j)).body.booking;
    assert.equal((await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job.pending, 2);
    const self = await call('POST', `/api/bookings/${b1.id}/attendance`, { token: w1.token, body: {} });
    assert.equal(self.body.source, 'worker_self'); assert.equal(self.body.verified, false); assert.equal(self.body.arrival_state, 'self_reported_arrived');
    assert.equal((await call('POST', `/api/bookings/${b1.id}/attendance`, { token: w1.token, body: {} })).body.error.code, 'ATTENDANCE_EXISTS');
    assert.equal((await call('POST', `/api/bookings/${b1.id}/attendance`, { token: w1.token, body: { status: 'absent' } })).status, 403);
    assert.equal((await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job.pending, 2); // self-report doesn't clear pending
    const rec = await call('POST', `/api/bookings/${b1.id}/attendance`, { token: c.token, body: {} });
    assert.equal(rec.body.arrival_state, 'recorded_arrived');
    const jj = (await call('GET', `/api/jobs/${j.id}`, { token: c.token })).body.job;
    assert.deepEqual([jj.pending, jj.arrived, jj.confirmed], [1, 1, 2]);
    assert.equal((await call('POST', `/api/bookings/${b1.id}/attendance`, { token: c.token, body: { work_date: s.tomorrow() } })).body.error.code, 'ATTENDANCE_DATE_INVALID');
    assert.equal((await call('POST', `/api/bookings/${b2.id}/attendance`, { token: w1.token, body: {} })).status, 404); // other worker's booking
    const team = (await call('GET', `/api/jobs/${j.id}/bookings`, { token: c.token })).body.bookings;
    assert.deepEqual(team.map(x => x.arrival_state).sort(), ['arrival_pending', 'recorded_arrived']);
  });

  await t.test('contractor cancelling a job cancels bookings and calculates NO compensation', async () => {
    const j = await job({ needed: 2 });
    await accept(w1, j);
    const r = await call('POST', `/api/jobs/${j.id}/cancel`, { token: c.token, body: { reason: 'client cancelled' } });
    assert.equal(r.body.job.status, 'cancelled'); assert.equal(r.body.cancelled_bookings, 1); assert.equal(r.body.compensation.calculated, false);
    assert.equal((await accept(w3, j)).status, 404);
  });

  await t.test('booking details are private to participants/admin', async () => {
    const j = await job();
    const b = (await accept(w1, j)).body.booking;
    assert.equal((await call('GET', `/api/bookings/${b.id}`, { token: w1.token })).status, 200);
    assert.equal((await call('GET', `/api/bookings/${b.id}`, { token: c.token })).status, 200);
    assert.equal((await call('GET', `/api/bookings/${b.id}`, { token: w2.token })).status, 404);
    const other = await s.register('other-c@example.com', 'contractor');
    assert.equal((await call('GET', `/api/bookings/${b.id}`, { token: other.token })).status, 404);
  });

  await t.test('idempotency key replays instead of double-booking/double-posting', async () => {
    const j = await job({ needed: 3 });
    const hdr = { 'Idempotency-Key': 'abc-123' };
    const a = await call('POST', `/api/jobs/${j.id}/accept`, { token: w3.token, body: { accept_terms: true, terms_version: 1 }, headers: hdr });
    const b = await call('POST', `/api/jobs/${j.id}/accept`, { token: w3.token, body: { accept_terms: true, terms_version: 1 }, headers: hdr });
    assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.headers.get('idempotent-replay'), 'true');
    assert.equal(b.body.booking.id, a.body.booking.id);
    const diff = await call('POST', `/api/jobs/${j.id}/accept`, { token: w3.token, body: { accept_terms: true, terms_version: 2 }, headers: hdr });
    assert.equal(diff.body.error.code, 'IDEMPOTENCY_CONFLICT');
  });
});

test('payments: separate states, dispute, correction history, privacy', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { call } = s;
  const c = await s.register('pc@example.com', 'contractor'), c2 = await s.register('pc2@example.com', 'contractor');
  const w = await s.register('9700000001', 'worker'), w2 = await s.register('9700000002', 'worker');
  const j = (await call('POST', '/api/jobs', { token: c.token, body: s.fullJob({ wage: 800, publish: true, confirm_reviewed: true }) })).body.job;
  const b = (await call('POST', `/api/jobs/${j.id}/accept`, { token: w.token, body: { accept_terms: true, terms_version: 1 } })).body.booking;
  await call('POST', `/api/bookings/${b.id}/attendance`, { token: c.token, body: {} });

  let pay;
  await t.test('only the job contractor can report; amounts validated; report is not "verified"', async () => {
    assert.equal((await call('POST', `/api/bookings/${b.id}/payments`, { token: w.token, body: { amount: 100 } })).status, 403);
    assert.equal((await call('POST', `/api/bookings/${b.id}/payments`, { token: c2.token, body: { amount: 100 } })).status, 404);
    for (const amount of [0, -5, 1.5, 'x', 99999999]) assert.equal((await call('POST', `/api/bookings/${b.id}/payments`, { token: c.token, body: { amount } })).body.error.code, 'VALIDATION');
    const r = await call('POST', `/api/bookings/${b.id}/payments`, { token: c.token, body: { amount: 500, method: 'cash', note: 'advance cash' } });
    assert.equal(r.status, 201); pay = r.body.payment;
    assert.equal(pay.status, 'reported'); assert.equal(pay.status_key, 'status_reported'); assert.equal(pay.verified_by_provider, false);
  });

  await t.test('summary keeps agreed, recorded, owed, reported, acknowledged separate', async () => {
    const sm = (await call('GET', `/api/bookings/${b.id}`, { token: w.token })).body.payment_summary;
    assert.equal(sm.agreed_daily_wage, 800); assert.equal(sm.days_recorded_by_contractor, 1); assert.equal(sm.earned_wages, 800);
    assert.equal(sm.reported_by_contractor_unacknowledged, 500); assert.equal(sm.acknowledged_by_worker, 0); assert.equal(sm.amount_owed, 300);
    assert.equal(sm.provider_verified_settlement, null);
  });

  await t.test('only the paid worker may acknowledge; state machine enforced', async () => {
    assert.equal((await call('POST', `/api/payments/${pay.id}/acknowledge`, { token: w2.token })).status, 404);
    assert.equal((await call('POST', `/api/payments/${pay.id}/acknowledge`, { token: c.token })).status, 403);
    assert.equal((await call('POST', `/api/payments/${pay.id}/acknowledge`, { token: w.token })).body.payment.status, 'acknowledged');
    assert.equal((await call('POST', `/api/payments/${pay.id}/acknowledge`, { token: w.token })).body.error.code, 'PAYMENT_STATE_INVALID');
    const sm = (await call('GET', `/api/bookings/${b.id}`, { token: w.token })).body.payment_summary;
    assert.equal(sm.acknowledged_by_worker, 500); assert.equal(sm.reported_by_contractor_unacknowledged, 0);
    assert.equal((await call('POST', `/api/payments/${pay.id}/correct`, { token: c.token, body: { amount: 100, reason: 'x' } })).body.error.code, 'PAYMENT_STATE_INVALID'); // can't rewrite acknowledged
  });

  await t.test('worker can dispute (reason required); disputed amount is not counted as paid; contractor can respond', async () => {
    assert.equal((await call('POST', `/api/payments/${pay.id}/dispute`, { token: w.token, body: {} })).body.error.code, 'DISPUTE_REASON_REQUIRED');
    const d = await call('POST', `/api/payments/${pay.id}/dispute`, { token: w.token, body: { reason: 'I got only 300' } });
    assert.equal(d.body.payment.status, 'disputed');
    const sm = (await call('GET', `/api/bookings/${b.id}`, { token: w.token })).body.payment_summary;
    assert.equal(sm.disputed_by_worker, 500); assert.equal(sm.amount_owed, 800);
    assert.equal((await call('POST', `/api/payments/${pay.id}/respond`, { token: c.token, body: { message: 'I paid 500, see UPI ref' } })).status, 200);
    assert.equal((await call('POST', `/api/payments/${pay.id}/respond`, { token: c2.token, body: { message: 'hi' } })).status, 404);
    // visible in admin queue
    const adminId = s.makeAdmin();
    const a = (await call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: 'AdminPassw0rd!' } })).body.token;
    const q = await call('GET', '/api/admin/payments', { token: a });
    assert.equal(q.body.payments.length, 1);
    assert.equal((await call('GET', '/api/admin/payments', { token: c.token })).status, 403);
  });

  await t.test('correction supersedes (keeps) the old record and preserves history; no destructive edits', async () => {
    const fix = await call('POST', `/api/payments/${pay.id}/correct`, { token: c.token, body: { amount: 300, reason: 'typo' } });
    assert.equal(fix.status, 201); assert.equal(fix.body.payment.corrects_id, pay.id); assert.equal(fix.body.payment.status, 'reported');
    const old = s.db.prepare('SELECT status, amount FROM payments WHERE id=?').get(pay.id);
    assert.equal(old.status, 'superseded'); assert.equal(old.amount, 500);
    const hist = (await call('GET', `/api/payments/${pay.id}`, { token: w.token })).body.history.map(e => e.event);
    assert.deepEqual(hist, ['reported', 'acknowledged', 'disputed', 'contractor_response', 'superseded']);
    assert.equal((await call('GET', '/api/payments', { token: w.token })).body.payments.length, 1); // superseded hidden by default
    assert.equal((await call('GET', '/api/payments?include_superseded=1', { token: w.token })).body.payments.length, 2);
  });

  await t.test('payment visibility is limited to the worker, the contractor and admins', async () => {
    assert.equal((await call('GET', `/api/payments/${pay.id}`, { token: w2.token })).status, 404);
    assert.equal((await call('GET', `/api/payments/${pay.id}`, { token: c2.token })).status, 404);
    assert.equal((await call('GET', '/api/payments', { token: w2.token })).body.payments.length, 0);
    assert.equal((await call('GET', '/api/payments', { token: c2.token })).body.payments.length, 0);
  });
});

test('help, safety reporting gate, admin separation, capabilities honesty', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { call } = s;
  const w = await s.register('9800000001', 'worker'), c = await s.register('hc@example.com', 'contractor');
  const adminId = s.makeAdmin();
  const a = (await call('POST', '/api/auth/login', { body: { identifier: 'admin@example.com', password: 'AdminPassw0rd!' } })).body.token;

  await t.test('ordinary help works and is labelled non-confidential; safety category is refused with guidance', async () => {
    const h = await call('POST', '/api/help', { token: w.token, body: { category: 'payment', message: 'Not paid yet' } });
    assert.equal(h.status, 201); assert.equal(h.body.confidential, false);
    const sf = await call('POST', '/api/help?lang=hi', { token: w.token, body: { category: 'safety', message: 'x' } });
    assert.equal(sf.body.error.code, 'SAFETY_REPORTING_NOT_ENABLED'); assert.match(sf.body.error.message, /112/);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM help_requests').get().n, 1);
  });

  await t.test('users see only their own help; admin sees all and can triage', async () => {
    await call('POST', '/api/help', { token: c.token, body: { category: 'other', message: 'hello' } });
    assert.equal((await call('GET', '/api/help', { token: w.token })).body.help.length, 1);
    const all = (await call('GET', '/api/admin/help', { token: a })).body.help;
    assert.equal(all.length, 2);
    assert.equal((await call('PATCH', `/api/admin/help/${all[0].id}`, { token: a, body: { status: 'resolved', response: 'Done' } })).status, 200);
    assert.equal((await call('PATCH', `/api/admin/help/${all[0].id}`, { token: a, body: { status: 'weird' } })).body.error.code, 'VALIDATION');
    assert.equal((await call('GET', '/api/admin/help', { token: w.token })).status, 403);
    assert.equal((await call('GET', '/api/admin/users', { token: c.token })).status, 403);
  });

  await t.test('admin can disable a user, which revokes sessions; actions are audited', async () => {
    assert.equal((await call('PATCH', `/api/admin/users/${w.id}`, { token: a, body: { disabled: true } })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: w.token })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: '9800000001', password: 'Passw0rd!x' } })).body.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await call('PATCH', `/api/admin/users/${adminId}`, { token: a, body: { disabled: true } })).status, 403);
    assert.ok((await call('GET', '/api/admin/audit', { token: a })).body.audit.some(x => x.action === 'user.disable'));
  });

  await t.test('capabilities endpoint does not claim unimplemented features', async () => {
    const cap = (await call('GET', '/api/capabilities')).body;
    for (const k of ['two_plus_one_allocation', 'advances_accounting', 'confidential_safety_reporting', 'verified_skills', 'real_money_movement', 'sms_whatsapp_push_notifications'])
      assert.ok(cap.not_implemented_requires_decision_or_provider[k], k);
    assert.ok(!cap.implemented.join(' ').match(/escrow|guarantee|verified_skills|gps|otp/));
  });

  await t.test('security headers, no-store, CORS allowlist', async () => {
    const r = await fetch(s.base + '/api/health', { headers: { Origin: 'http://localhost:8080' } });
    assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080');
    const evil = await fetch(s.base + '/api/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  await t.test('static frontend serving blocks path traversal', async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-')); fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>'); fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'secret');
    const s2 = await startServer({ staticDir: dir });
    try {
      const home = await fetch(s2.base + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /hi/);
      const trav = await fetch(s2.base + '/..%2fsecret.txt'); assert.notEqual(trav.status, 200);
    } finally { await s2.close(); }
  });
});

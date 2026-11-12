'use strict';
// DEVELOPMENT ONLY demo data mirroring the frontend demo (jobs j1/j2 + three payment states).
// Refuses to run in production or on a database that already has users.
const { loadConfig } = require('../src/config');
const { openDb, now } = require('../src/db');
const S = require('../src/security');
const V = require('../src/validate');

const cfg = loadConfig();
if (cfg.production) { console.error('Refusing to seed demo data in production.'); process.exit(1); }
const db = openDb(cfg.dbPath);
if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) { console.error('Database already has users; not seeding.'); process.exit(1); }

const PW = 'Demo@12345';
const hash = S.hashPassword(PW);
const user = (ident, type, name, role, skills = '') => {
  const id = S.newId('u');
  db.prepare('INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, lang, skills, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, ident, type, name, role, hash, 'en', skills, now()); return id;
};
const contractor = user('suresh@example.com', 'email', 'Suresh', 'contractor');
const ramesh = user('9000000001', 'phone', 'Ramesh', 'worker', 'Brick mason');
const mohan = user('9000000002', 'phone', 'Mohan', 'worker', 'General helper');
const vikram = user('9000000003', 'phone', 'Vikram', 'worker', 'Plasterer');
const today = V.todayIST();
const job = (id, f) => db.prepare(`INSERT INTO jobs (id, contractor_id, title, skill, wage, location, date, time, duration, hours, equipment, paytime, cancel, needed, status, published_at, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`).run(id, contractor, f.title, f.skill, f.wage, f.location, today, f.time, f.duration, f.hours, f.equipment, f.paytime, f.cancel, f.needed, now(), now(), now());
job('j1', { title: 'Bricklaying', skill: 'Brick mason', wage: 850, location: 'Sector 12, Gurugram', time: '08:00', duration: '8 days', hours: '8 hrs, 1 hr lunch break', equipment: 'Contractor provides tools', paytime: 'Same day, evening', cancel: 'Cancel before 6 PM a day prior; no charge.', needed: 3 });
job('j2', { title: 'Site cleaning', skill: 'General helper', wage: 500, location: 'DLF Phase 1, Gurugram', time: '07:30', duration: '2 days', hours: '8 hrs', equipment: 'Worker brings own gloves', paytime: 'Next morning', cancel: 'Inform by 8 PM previous day.', needed: 4 });
job('j3', { title: 'Plastering', skill: 'Plasterer', wage: 900, location: 'Sector 8, Gurugram', time: '08:00', duration: '3 days', hours: '8 hrs', equipment: 'Contractor provides tools', paytime: 'Weekly', cancel: 'Inform 1 day before.', needed: 2 });
const book = (jid, wid) => { const id = S.newId('b'); db.prepare("INSERT INTO bookings (id, job_id, worker_id, status, accepted_terms_version, accepted_at, created_at) VALUES (?,?,?,'confirmed',1,?,?)").run(id, jid, wid, now(), now());
  db.prepare("INSERT INTO attendance (booking_id, work_date, status, source, recorded_by, created_at) VALUES (?,?,'arrived','contractor',?,?)").run(id, today, contractor, now()); return id; };
const pay = (bid, amount, status, reason = '') => db.prepare("INSERT INTO payments (id, booking_id, amount, paid_on, method, reported_by, status, dispute_reason, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(S.newId('p'), bid, amount, today, 'cash', contractor, status, reason, now(), now());
pay(book('j1', ramesh), 850, 'acknowledged');
pay(book('j2', mohan), 500, 'reported');
pay(book('j3', vikram), 900, 'disputed', 'I have not received this amount.');
console.log('Seeded. DEV logins (password for all: ' + PW + '): suresh@example.com (contractor), 9000000001 Ramesh, 9000000002 Mohan, 9000000003 Vikram (workers).');

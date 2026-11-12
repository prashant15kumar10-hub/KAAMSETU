'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/* Versioned, additive migrations. The database is NEVER dropped or reset by the app.
   To change the schema later, append a new migration; never edit an applied one. */
const MIGRATIONS = [
  {
    id: 1, name: 'init',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,            -- normalized email (lowercase) or 10-digit mobile
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('email','phone')),
  identifier_verified INTEGER NOT NULL DEFAULT 0,  -- no OTP/email provider configured: always 0
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('worker','contractor','admin')),
  password_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('hi','en')),
  skills TEXT NOT NULL DEFAULT '',            -- worker SELF-DECLARED, never "verified"
  location TEXT NOT NULL DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  skill TEXT NOT NULL DEFAULT '',
  wage INTEGER,                               -- rupees per day
  location TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',              -- reporting date YYYY-MM-DD
  time TEXT NOT NULL DEFAULT '',              -- reporting time HH:MM
  duration TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  paytime TEXT NOT NULL DEFAULT '',
  cancel TEXT NOT NULL DEFAULT '',
  needed INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','cancelled')),
  terms_version INTEGER NOT NULL DEFAULT 1,
  source_job_id TEXT,                         -- set when created via "Repeat this job" (details only)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX idx_jobs_contractor ON jobs(contractor_id);
CREATE INDEX idx_jobs_status ON jobs(status);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','needs_reacceptance','cancelled_by_worker','cancelled_by_contractor')),
  accepted_terms_version INTEGER,
  accepted_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (job_id, worker_id)                  -- duplicate-booking protection at the database level
);
CREATE INDEX idx_bookings_worker ON bookings(worker_id);

-- Append-only history (evidence for disputes). Rows are never updated or deleted by the app.
CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  actor_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Attendance. source='contractor' = contractor-recorded; 'worker_self' = worker-reported (NOT verified).
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  work_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('arrived','absent')),
  source TEXT NOT NULL CHECK (source IN ('contractor','worker_self')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (booking_id, work_date, source)
);

-- Payment REPORTS. A report is a statement, not bank proof. Old rows are 'superseded', never overwritten.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'other' CHECK (method IN ('cash','upi','bank','other')),
  note TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('reported','acknowledged','disputed','superseded')),
  dispute_reason TEXT NOT NULL DEFAULT '',
  corrects_id TEXT REFERENCES payments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE TABLE payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  actor_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Ordinary help requests only. Confidential safety reporting is NOT implemented (needs policy approval).
CREATE TABLE help_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('payment','booking','account','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  response TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Replays the stored response if a client retries the same POST (double-tap / flaky network).
CREATE TABLE idempotency (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_sig TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, user_id)
);
`,
  },
  {
    id: 2, name: 'operational_indexes',
    sql: `
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_help_user ON help_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
`,
  },
  {
    id: 3, name: 'identity_verification_and_admin_mfa',
    sql: `
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_pending_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
CREATE TABLE verification_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE auth_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('admin_mfa_setup','admin_mfa_verify')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_challenges_expiry ON auth_challenges(expires_at);
`,
  },
];

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:' && process.platform !== 'win32') { try { fs.chmodSync(dbPath, 0o600); } catch {} }
  db.exec('PRAGMA foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    if (process.platform !== 'win32') for (const suffix of ['-wal', '-shm']) { try { fs.chmodSync(dbPath + suffix, 0o600); } catch {} }
  }
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)').run(m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

const now = () => new Date().toISOString();
module.exports = { openDb, tx, now, MIGRATIONS };

'use strict';
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const S = require('../src/security');
const { now } = require('../src/db');

async function startServer(over = {}, deps = {}) {
  const cfg = { ...loadConfig({}), logLevel: 'silent', ...over };
  const db = openDb(':memory:');
  const server = createApp(db, cfg, deps);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, body: json, headers: res.headers };
  };
  const register = async (identifier, role, name = 'User') => {
    const r = await call('POST', '/api/auth/register', { body: { identifier, password: 'Passw0rd!x', name, role } });
    if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.body));
    return { token: r.body.token, id: r.body.user.id };
  };
  const makeAdmin = () => {
    const id = S.newId('u');
    db.prepare("INSERT INTO users (id, identifier, identifier_type, name, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, 'admin@example.com', 'email', 'Admin', 'admin', S.hashPassword('AdminPassw0rd!'), now());
    return id;
  };
  const tomorrow = () => new Date(Date.now() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const fullJob = (over = {}) => ({ title: 'Bricklaying', skill: 'Brick mason', wage: '850', location: 'Sector 12, Gurugram', date: today(), time: '08:00',
    duration: '8 days', hours: '8 hrs, 1 hr lunch', equipment: 'Contractor provides tools', paytime: 'Same day', cancel: 'Cancel before 6 PM prior day', needed: 2, ...over });
  const close = () => new Promise(r => { server.close(() => { db.close(); r(); }); });
  return { base, server_router: server.router, server, call, register, makeAdmin, db, close, today, tomorrow, fullJob };
}
module.exports = { startServer };

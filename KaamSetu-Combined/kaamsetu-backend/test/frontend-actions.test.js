'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('CSP-safe data-action dispatcher parses literal calls and rejects expressions', () => {
  const handlers = {}; const calls = [];
  const document = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const sandbox = { document, console, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    KS: { langProvider: null, onUnauthorized: null }, I18N: { en: {}, hi: {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../../kaamsetu-frontend/js/app.js'), 'utf8');
  vm.runInContext(source, sandbox, { timeout: 2000 });
  sandbox.go = (...args) => calls.push(args);
  function click(action) {
    let prevented = false;
    handlers.click({ target: { closest: selector => selector === '[data-action]' ? { getAttribute: () => action } : null }, preventDefault: () => { prevented = true; } });
    return prevented;
  }
  assert.equal(click("go('jobDetail',{id:'job_abc',from:'findWork'})"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'jobDetail');
  assert.equal(calls[0][1].id, 'job_abc');
  assert.equal(calls[0][1].from, 'findWork');
  assert.equal(click("go((()=>{throw Error('no')})())"), false);
  assert.equal(calls.length, 1);
});

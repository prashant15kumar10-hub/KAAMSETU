/* KAAMSETU API client. The session token lives in sessionStorage (cleared when the tab closes - safer on shared phones),
   with an in-memory fallback if storage is blocked. Retried POSTs reuse their Idempotency-Key after a network failure,
   so a flaky connection or a double tap cannot create a duplicate booking/job/payment. */
(function () {
  "use strict";
  var TOKEN_KEY = "ks_token", TIMEOUT_MS = 20000;
  var memToken = null, pending = {};
  var tok = {
    get: function () { try { return sessionStorage.getItem(TOKEN_KEY) || memToken; } catch (e) { return memToken; } },
    set: function (v) { memToken = v; try { sessionStorage.setItem(TOKEN_KEY, v); } catch (e) {} },
    clear: function () { memToken = null; try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  };
  var KS = { onUnauthorized: null, langProvider: null };

  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  async function request(method, path, body) {
    var base = window.KAAMSETU_API_BASE || "/api";
    var headers = { "Content-Type": "application/json" };
    var t = tok.get(); if (t) headers.Authorization = "Bearer " + t;
    var lang = KS.langProvider && KS.langProvider(); if (lang) headers["X-Language"] = lang;
    var sig = null;
    if (method === "POST") {
      sig = path + "\n" + JSON.stringify(body || {});
      if (!pending[sig]) pending[sig] = newKey();
      headers["Idempotency-Key"] = pending[sig];
    }
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS), res;
    try {
      res = await fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      // No answer: the server may or may not have processed it. Keep the key so a retry is safe.
      var ne = new Error("NETWORK"); ne.code = ctrl.signal.aborted ? "TIMEOUT" : "NETWORK"; ne.network = true; throw ne;
    } finally { clearTimeout(timer); }
    if (sig) delete pending[sig]; // the server answered: the next identical action is a new action
    var data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var er = (data && data.error) || {};
      var err = new Error(er.message || "ERROR");
      err.code = er.code || "HTTP_" + res.status; err.status = res.status; err.details = er.details || {}; err.requestId = er.request_id || null;
      if (res.status === 401 && (err.code === "SESSION_EXPIRED" || err.code === "UNAUTHENTICATED") && t) {
        tok.clear();
        if (KS.onUnauthorized) KS.onUnauthorized(err);
      }
      throw err;
    }
    return data;
  }

  KS.get = function (p) { return request("GET", p); };
  KS.post = function (p, b) { return request("POST", p, b || {}); };
  KS.put = function (p, b) { return request("PUT", p, b || {}); };
  KS.patch = function (p, b) { return request("PATCH", p, b || {}); };
  KS.hasToken = function () { return !!tok.get(); };
  KS.clearToken = tok.clear;
  KS.login = async function (identifier, password) { var d = await request("POST", "/auth/login", { identifier: identifier, password: password }); if (d.verification_required || d.mfa_required || d.mfa_setup_required) return d; tok.set(d.token); return d; };
  KS.register = async function (payload) { var d = await request("POST", "/auth/register", payload); if (d.verification_required) return d; tok.set(d.token); return d; };
  KS.confirmVerification = function (identifier, code) { return request("POST", "/auth/verification/confirm", { identifier: identifier, code: code }); };
  KS.completeAdminMfa = async function (setup, challengeToken, code) { var path = setup ? "/auth/admin-mfa/setup" : "/auth/admin-mfa/verify"; var d = await request("POST", path, { challenge_token: challengeToken, code: code }); tok.set(d.token); return d.user; };
  KS.me = async function () { return (await request("GET", "/auth/me")).user; };
  KS.logout = async function () { try { await request("POST", "/auth/logout", {}); } finally { tok.clear(); } };
  window.KS = KS;
})();

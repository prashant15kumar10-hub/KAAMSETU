/* OPTIONAL helper — not part of the frontend you sent; add it yourself if you want it.
   Usage: <script src="client/kaamsetu-api.js"></script>, then  await KS.login(...), await KS.get('/jobs') */
(function () {
  const TOKEN_KEY = 'ks_token';
  let base = '/api'; // same origin when served with STATIC_DIR; else e.g. 'http://localhost:3000/api'
  const store = { get(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } },
                  set(k,v){ try { sessionStorage.setItem(k,v); } catch(e){} },
                  del(k){ try { sessionStorage.removeItem(k); } catch(e){} } };
  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = store.get(TOKEN_KEY); if (tok) headers.Authorization = 'Bearer ' + tok;
    const lang = (typeof window.lang !== 'undefined' && window.lang) || null; if (lang) headers['X-Language'] = lang;
    if (method === 'POST') headers['Idempotency-Key'] = opts.key || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    let res;
    try { res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { const err = new Error('NETWORK'); err.code = 'NETWORK'; throw err; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error((data.error && data.error.message) || 'ERROR'); err.code = data.error && data.error.code; err.status = res.status; err.details = data.error && data.error.details; throw err; }
    return data;
  }
  window.KS = {
    setBase(b) { base = b; },
    get: (p) => request('GET', p), post: (p, b, o) => request('POST', p, b || {}, o), put: (p, b) => request('PUT', p, b || {}), patch: (p, b) => request('PATCH', p, b || {}),
    async login(identifier, password) { const d = await request('POST', '/auth/login', { identifier, password }); store.set(TOKEN_KEY, d.token); return d.user; },
    async register(payload) { const d = await request('POST', '/auth/register', payload); store.set(TOKEN_KEY, d.token); return d.user; },
    async logout() { try { await request('POST', '/auth/logout', {}); } finally { store.del(TOKEN_KEY); } },
  };
})();

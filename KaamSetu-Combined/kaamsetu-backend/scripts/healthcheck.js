'use strict';
// Used by Docker HEALTHCHECK / monitors: exits 0 if /api/ready answers ok, else 1.
const port = process.env.PORT || '3000';
const host = process.env.HEALTHCHECK_HOST || '127.0.0.1';
fetch(`http://${host}:${port}/api/ready`, { signal: AbortSignal.timeout(4000) })
  .then(r => r.json().then(j => process.exit(r.ok && j.ok ? 0 : 1)))
  .catch(() => process.exit(1));

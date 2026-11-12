'use strict';
class ApiError extends Error {
  constructor(status, code, params = {}) { super(code); this.status = status; this.code = code; this.params = params; }
}
const bad = (field, reason) => new ApiError(422, 'VALIDATION', { field, reason });
module.exports = { ApiError, bad };

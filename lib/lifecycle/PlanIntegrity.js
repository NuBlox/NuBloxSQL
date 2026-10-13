'use strict';

// A SHA-256 plan hash verifies serialized-content integrity, not authorship.
// Execution authorization and target binding remain separate trusted gates.
const crypto = require('node:crypto');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach(function (key) { freeze(value[key]); });
    Object.freeze(value);
  }
  return value;
}

function validatedPlan(value, label) {
  label = label || 'NuBloxSQL lifecycle';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' requires a plan object');
  }
  // Take one serialized snapshot, preventing mutations of caller-owned
  // objects between validation and an executor's awaited provider operations.
  var serialized;
  try { serialized = JSON.stringify(value); }
  catch (_) { throw new TypeError(label + ' requires a JSON-serializable plan'); }
  if (!serialized || serialized.length > 2000000) {
    throw new TypeError(label + ' requires a bounded JSON-serializable plan');
  }
  var snapshot = JSON.parse(serialized);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      typeof snapshot.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.planHash)) {
    throw new TypeError(label + ' requires a SHA-256 plan hash');
  }
  var core = {};
  Object.keys(snapshot).forEach(function (key) {
    if (key !== 'planHash') core[key] = snapshot[key];
  });
  var actual = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(snapshot.planHash, 'hex'))) {
    throw new Error(label + ' plan hash mismatch: the plan contents differ from the approved plan');
  }
  return freeze(snapshot);
}

module.exports = Object.freeze({ validatedPlan });

'use strict';

// Hashes are integrity checks, NOT proof of approval or target authorization.
// Snapshotting first ensures the executor cannot consume a mutable plan after
// verifying a different serialization of the same input object.
const crypto = require('node:crypto');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach(key => freeze(value[key]));
    Object.freeze(value);
  }
  return value;
}

function verifyPlan(value, label) {
  label = label || 'NuBloxSQL lifecycle';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' requires a plan object');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(JSON.stringify(value));
  } catch (_) {
    throw new TypeError(label + ' plan must be JSON serializable');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      typeof snapshot.planHash !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.planHash)) {
    throw new TypeError(label + ' requires a valid SHA-256 planHash');
  }
  const core = {};
  for (const key of Object.keys(snapshot)) {
    if (key !== 'planHash') {
      Object.defineProperty(core, key, {
        value: snapshot[key], enumerable: true, configurable: true, writable: true
      });
    }
  }
  const expected = crypto.createHash('sha256').update(JSON.stringify(core)).digest();
  const received = Buffer.from(snapshot.planHash, 'hex');
  if (!crypto.timingSafeEqual(expected, received)) {
    throw new Error(label + ' planHash integrity mismatch: plan content changed after planning');
  }
  return freeze(snapshot);
}

module.exports = Object.freeze({ verifyPlan });

'use strict';

// Internal same-host scheduler loop. The SQLite JobStore remains the atomic
// source of truth; this service does not own leases, job execution or auth.
function createSchedulerService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('scheduler service options must be an object');
  }
  const { store, approvalPolicy, registry } = options;
  if (!store || store.kind !== 'sqlite-local' || store.distributed !== false ||
      typeof store.dispatchDueSchedules !== 'function') {
    throw new TypeError('scheduler service requires the same-host SQLite JobStore');
  }
  if (!approvalPolicy || typeof approvalPolicy.evaluate !== 'function' ||
      !registry || typeof registry.resolve !== 'function') {
    throw new TypeError('scheduler service requires a trusted approvalPolicy and executor registry');
  }
  const pollIntervalMs = options.pollIntervalMs === undefined ? 1000 : options.pollIntervalMs;
  const maxBackoffMs = options.maxBackoffMs === undefined ? 60000 : options.maxBackoffMs;
  const limit = options.limit === undefined ? 20 : options.limit;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 3600000) {
    throw new RangeError('pollIntervalMs must be 100..3600000');
  }
  if (!Number.isSafeInteger(maxBackoffMs) || maxBackoffMs < pollIntervalMs ||
      maxBackoffMs > 86400000) {
    throw new RangeError('maxBackoffMs must be >= pollIntervalMs and <= 86400000');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('scheduler service limit must be 1..100');
  }
  const clock = options.clock || Date.now;
  if (typeof clock !== 'function') throw new TypeError('scheduler service clock must be a function');
  const timers = options.timers || { setTimeout, clearTimeout };
  if (!timers || typeof timers.setTimeout !== 'function' ||
      typeof timers.clearTimeout !== 'function') {
    throw new TypeError('scheduler service timers must implement setTimeout and clearTimeout');
  }
  if (options.onEvent !== undefined && typeof options.onEvent !== 'function') {
    throw new TypeError('scheduler service onEvent must be a function');
  }

  let phase = 'idle';
  let timer = null;
  let inFlight = null;
  let nextPollAt = null;
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let lastError = null;
  let polls = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let queued = 0;
  let skipped = 0;
  let disabled = 0;

  function timestamp() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('scheduler service clock returned an invalid date');
    return date.toISOString();
  }

  function status() {
    return Object.freeze({
      phase, inFlight: inFlight !== null, nextPollAt,
      lastAttemptAt, lastSuccessAt, lastFailureAt, lastError,
      polls, failures, consecutiveFailures, queued, skipped, disabled
    });
  }

  function emit(type, fields = {}) {
    if (!options.onEvent) return;
    // Intentionally never copy errors, SQL, plans or database targets to events.
    try {
      options.onEvent(Object.freeze({ type, at: timestamp(), ...fields }));
    } catch (_) {
      // An observability sink cannot change scheduler execution semantics.
    }
  }

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    nextPollAt = null;
  }

  function backoff() {
    // Use bounded integer arithmetic, not unbounded exponentiation.
    let delay = pollIntervalMs;
    for (let i = 1; i < consecutiveFailures && delay < maxBackoffMs; i++) {
      delay = Math.min(maxBackoffMs, delay * 2);
    }
    return delay;
  }

  function scheduleNext() {
    if (phase !== 'running') return;
    const delay = consecutiveFailures ? backoff() : pollIntervalMs;
    nextPollAt = new Date(Date.parse(timestamp()) + delay).toISOString();
    try {
      timer = timers.setTimeout(() => {
        timer = null;
        nextPollAt = null;
        // Poll resolves to sanitized statistics even when storage fails.
        void pollNow();
      }, delay);
    } catch (_) {
      phase = 'stopped';
      nextPollAt = null;
      lastFailureAt = timestamp();
      lastError = 'timer-unavailable';
      failures++;
      emit('service-stopped', { reason: 'timer-unavailable' });
    }
  }

  function pollNow() {
    if (phase !== 'running') return Promise.reject(new Error('scheduler service is not running'));
    if (inFlight !== null) return inFlight;
    clearTimer();
    inFlight = Promise.resolve().then(() => {
      // Stop before an asynchronous tick begins must not dispatch work.
      if (phase !== 'running') return null;
      lastAttemptAt = timestamp();
      return store.dispatchDueSchedules({ approvalPolicy, registry, limit });
    }).then(results => {
      if (results === null) return Object.freeze({ queued: 0, skipped: 0, disabled: 0, interrupted: true });
      if (!Array.isArray(results) || results.length > limit ||
          results.some(result => !result || !['queued','skipped','disabled'].includes(result.status))) {
        throw new Error('invalid scheduler dispatch result');
      }
      const current = { queued: 0, skipped: 0, disabled: 0 };
      for (const result of results) current[result.status]++;
      polls++;
      queued += current.queued;
      skipped += current.skipped;
      disabled += current.disabled;
      consecutiveFailures = 0;
      lastError = null;
      lastSuccessAt = timestamp();
      emit('poll-completed', current);
      return Object.freeze(current);
    }).catch(() => {
      // Fail closed. Never leak driver messages, paths, connection details or SQL.
      polls++;
      failures++;
      consecutiveFailures++;
      lastFailureAt = timestamp();
      lastError = 'dispatch-failed';
      emit('poll-failed', { reason: lastError, consecutiveFailures });
      return Object.freeze({ queued: 0, skipped: 0, disabled: 0, failed: true });
    }).finally(() => {
      inFlight = null;
      scheduleNext();
    });
    return inFlight;
  }

  async function start() {
    if (phase === 'running') return status();
    if (phase === 'stopping') throw new Error('scheduler service is stopping');
    phase = 'running';
    emit('service-started');
    await pollNow();
    return status();
  }

  async function stop() {
    if (phase === 'stopped') return status();
    phase = 'stopping';
    clearTimer();
    if (inFlight !== null) await inFlight;
    phase = 'stopped';
    emit('service-stopped', { reason: 'requested' });
    return status();
  }

  return Object.freeze({ start, stop, pollNow, status });
}

module.exports = Object.freeze({ createSchedulerService });

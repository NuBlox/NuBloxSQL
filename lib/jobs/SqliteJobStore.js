'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jobs = require('./JobKernel');
const recurrence = require('./JobSchedule');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 4;
const ACTIVE_LEASE_STATUSES = Object.freeze(['leased', 'running', 'verifying', 'cancelling']);
const ORPHANABLE_LEASE_STATUSES = Object.freeze(['running', 'verifying', 'cancelling']);

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a nonempty string');
  return value;
}

function dateMs(value, label) {
  nonEmpty(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(label + ' must be a valid date');
  return ms;
}

function canonicalJson(value) {
  return JSON.stringify(jobs.safeCopy(value));
}

function parseJson(value) {
  return jobs.safeCopy(JSON.parse(value));
}

function validatePlan(plan) {
  return jobs.validatePlan(plan);
}

function validateRun(run) {
  if (!run || typeof run !== 'object') throw new TypeError('job run must be an object');
  nonEmpty(run.runId, 'runId');
  nonEmpty(run.planHash, 'planHash');
  nonEmpty(run.status, 'status');
  if (!jobs.TRANSITIONS[run.status]) throw new TypeError('job run status is invalid');
  if (!Number.isSafeInteger(run.version) || run.version < 0) throw new TypeError('job run version must be a nonnegative safe integer');
  if (!Number.isSafeInteger(run.attempt) || run.attempt < 0) throw new TypeError('job run attempt must be a nonnegative safe integer');
  dateMs(run.createdAt, 'job run createdAt');
  if (run.schemaVersion !== jobs.SCHEMA_VERSION) throw new TypeError('unsupported job run schema version');
  return jobs.safeCopy(run);
}

function stripLease(run) {
  const value = Object.assign({}, run);
  delete value.lease;
  return jobs.safeCopy(value);
}

function runFromRow(row) {
  if (!row) return null;
  const value = Object.assign({}, parseJson(row.payload), {
    status: row.status,
    version: Number(row.version),
    attempt: Number(row.attempt)
  });
  if (row.lease_worker_id !== null) {
    value.lease = {
      workerId: row.lease_worker_id,
      fence: Number(row.lease_fence),
      expiresAt: row.lease_expires_at
    };
  } else {
    delete value.lease;
  }
  return jobs.safeCopy(value);
}

function createStore(options) {
  options = options || {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('SQLite JobStore options must be an object');
  const filename = nonEmpty(options.filename, 'SQLite JobStore filename');
  if (filename === ':memory:') throw new TypeError('SQLite JobStore requires a file-backed database');
  const absolute = path.resolve(filename);
  if (options.createDirectory !== false) fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const timeout = options.busyTimeout === undefined ? 5000 : Number(options.busyTimeout);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000) throw new RangeError('SQLite JobStore busyTimeout must be between 1 and 60000 milliseconds');

  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  function nowIso() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('SQLite JobStore clock returned an invalid date');
    return date.toISOString();
  }

  const db = new DatabaseSync(absolute, { timeout: timeout });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = ' + Math.trunc(timeout));
  const journal = db.prepare('PRAGMA journal_mode = WAL').get();
  const journalMode = String((journal && (journal.journal_mode || journal.journalMode)) || '').toLowerCase();
  if (journalMode !== 'wal') {
    db.close();
    throw new Error('SQLite JobStore requires WAL mode on a local filesystem');
  }

  const versionRow = db.prepare('PRAGMA user_version').get();
  const currentVersion = Number(versionRow && versionRow.user_version || 0);
  if (currentVersion !== 0 && currentVersion !== 1 && currentVersion !== 2 && currentVersion !== 3 && currentVersion !== SCHEMA_VERSION) {
    db.close();
    throw new Error('unsupported SQLite JobStore schema version: ' + currentVersion);
  }

  if (currentVersion === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_plans (
          plan_hash TEXT PRIMARY KEY NOT NULL,
          schema_version INTEGER NOT NULL,
          payload TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS job_runs (
          run_id TEXT PRIMARY KEY NOT NULL,
          plan_hash TEXT NOT NULL REFERENCES job_plans(plan_hash),
          status TEXT NOT NULL,
          version INTEGER NOT NULL,
          attempt INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_at TEXT,
          payload TEXT NOT NULL,
          lease_worker_id TEXT,
          lease_fence INTEGER NOT NULL DEFAULT 0,
          lease_expires_at TEXT,
          lease_expires_ms INTEGER
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_job_runs_queue
          ON job_runs(status, created_ms, run_id);

        CREATE INDEX IF NOT EXISTS idx_job_runs_lease
          ON job_runs(status, lease_expires_ms);

        CREATE TABLE IF NOT EXISTS job_events (
          event_id INTEGER PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES job_runs(run_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(run_id, sequence)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_job_events_run
          ON job_events(run_id, sequence);

        PRAGMA user_version = 1;
      `);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      db.close();
      throw error;
    }
  }


  // Upgrade existing same-host JobStore files without discarding runs or events.
  // Approval rows are stored separately from immutable plans and run checkpoints.
  if (currentVersion <= 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_approvals (
          run_id TEXT PRIMARY KEY NOT NULL REFERENCES job_runs(run_id) ON DELETE CASCADE,
          plan_hash TEXT NOT NULL,
          payload TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 2;
      `);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      db.close();
      throw error;
    }
  }


  if (currentVersion <= 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_cancellations (
          run_id TEXT PRIMARY KEY NOT NULL REFERENCES job_runs(run_id) ON DELETE CASCADE,
          payload TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 3;
      `);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      db.close();
      throw error;
    }
  }


  // v4: the scheduler is a same-host, transactionally fenced run producer.
  // A schedule is not a job; dispatch creates an independent, auditable run.
  if (currentVersion <= 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_schedules (
          schedule_id TEXT PRIMARY KEY NOT NULL,
          plan_hash TEXT NOT NULL REFERENCES job_plans(plan_hash),
          payload TEXT NOT NULL,
          enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
          next_due_ms INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_job_schedules_due
          ON job_schedules(enabled,next_due_ms,schedule_id);
        CREATE TABLE IF NOT EXISTS job_schedule_occurrences (
          schedule_id TEXT NOT NULL REFERENCES job_schedules(schedule_id),
          scheduled_ms INTEGER NOT NULL,
          run_id TEXT NOT NULL UNIQUE REFERENCES job_runs(run_id),
          PRIMARY KEY(schedule_id, scheduled_ms)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS job_schedule_events (
          event_id INTEGER PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES job_schedules(schedule_id),
          created_at TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_schedule_events
          ON job_schedule_events(schedule_id,event_id);
        PRAGMA user_version = 4;
      `);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      db.close();
      throw error;
    }
  }

  const cancellationAuthorizer = options.cancellationAuthorizer;
  if (cancellationAuthorizer !== undefined && typeof cancellationAuthorizer !== 'function') {
    db.close();
    throw new TypeError('cancellationAuthorizer must be a trusted synchronous function');
  }
  const approvalAuthorizer = options.approvalAuthorizer;
  if (approvalAuthorizer !== undefined && typeof approvalAuthorizer !== 'function') {
    db.close();
    throw new TypeError('approvalAuthorizer must be a trusted synchronous function');
  }

  let closed = false;
  function assertOpen() {
    if (closed) throw new Error('SQLite JobStore is closed');
  }

  function transaction(fn) {
    assertOpen();
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  function eventSequence(runId) {
    const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM job_events WHERE run_id = ?').get(runId);
    return Number(row.sequence);
  }

  function appendEventTx(runId, event, createdAt) {
    const normalized = jobs.safeCopy(event);
    nonEmpty(normalized.type, 'job event type');
    const sequence = eventSequence(runId);
    const result = db.prepare(
      'INSERT INTO job_events(run_id, sequence, event_type, created_at, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(runId, sequence, normalized.type, createdAt || nowIso(), canonicalJson(normalized));
    return Object.freeze({ eventId: Number(result.lastInsertRowid), sequence: sequence });
  }

  function getRunRow(runId) {
    return db.prepare('SELECT * FROM job_runs WHERE run_id = ?').get(runId);
  }

  function writeRunTx(run, expectedVersion, currentRow) {
    const normalized = validateRun(run);
    const lease = normalized.lease || null;
    const leaseExpiresMs = lease ? dateMs(lease.expiresAt, 'lease expiresAt') : null;
    const persistedFence = lease ? lease.fence : Number(currentRow && currentRow.lease_fence || 0);
    const result = db.prepare(`
      UPDATE job_runs
         SET status = ?,
             version = ?,
             attempt = ?,
             updated_at = ?,
             payload = ?,
             lease_worker_id = ?,
             lease_fence = ?,
             lease_expires_at = ?,
             lease_expires_ms = ?
       WHERE run_id = ? AND version = ?
    `).run(
      normalized.status,
      normalized.version,
      normalized.attempt,
      normalized.updatedAt || null,
      canonicalJson(stripLease(normalized)),
      lease ? lease.workerId : null,
      persistedFence,
      lease ? lease.expiresAt : null,
      leaseExpiresMs,
      normalized.runId,
      expectedVersion
    );
    if (Number(result.changes) !== 1) throw new Error('job run version conflict');
  }

  function validateLeaseTransition(current, normalized, transitionAt) {
    const currentHoldsLease = ACTIVE_LEASE_STATUSES.includes(current.status);
    const nextHoldsLease = jobs.LEASE_HOLDING.includes(normalized.status);

    if (!currentHoldsLease && nextHoldsLease) {
      throw new Error('lease acquisition requires atomic JobStore leaseNextRun');
    }

    if (!currentHoldsLease) {
      if (normalized.lease) throw new Error('job run without an active lease cannot persist lease evidence');
      return;
    }

    if (current.lease_worker_id === null || current.lease_expires_ms === null || Number(current.lease_fence) < 1) {
      throw new Error('persisted job lease is invalid');
    }

    const transitionMs = dateMs(transitionAt, 'job transition time');
    if (Number(current.lease_expires_ms) <= transitionMs) throw new Error('job lease has expired');

    if (nextHoldsLease) {
      if (!normalized.lease ||
          normalized.lease.workerId !== current.lease_worker_id ||
          normalized.lease.fence !== Number(current.lease_fence) ||
          normalized.lease.expiresAt !== current.lease_expires_at) {
        throw new Error('job transition cannot replace or extend the active lease');
      }
    } else if (normalized.lease) {
      throw new Error('job transition releasing a lease must clear lease evidence');
    }
  }

  function requeueExpiredUnstartedTx(now, nowMs) {
    const rows = db.prepare(
      "SELECT * FROM job_runs WHERE status = 'leased' AND lease_expires_ms IS NOT NULL AND lease_expires_ms <= ? ORDER BY lease_expires_ms, run_id"
    ).all(nowMs);
    const recovered = [];
    for (const row of rows) {
      const current = runFromRow(row);
      const nextValue = Object.assign({}, stripLease(current), {
        status: 'queued',
        version: current.version + 1,
        updatedAt: now,
        reason: 'lease-expired-before-start'
      });
      const next = jobs.safeCopy(nextValue);
      const result = db.prepare(`
        UPDATE job_runs
           SET status = 'queued',
               version = ?,
               updated_at = ?,
               payload = ?,
               lease_worker_id = NULL,
               lease_expires_at = NULL,
               lease_expires_ms = NULL
         WHERE run_id = ? AND version = ? AND status = 'leased'
      `).run(next.version, now, canonicalJson(stripLease(next)), current.runId, current.version);
      if (Number(result.changes) !== 1) throw new Error('job lease recovery conflict');
      appendEventTx(current.runId, {
        type: 'lease-expired',
        from: 'leased',
        to: 'queued',
        workerId: current.lease.workerId,
        fence: current.lease.fence,
        expiresAt: current.lease.expiresAt
      }, now);
      recovered.push(next);
    }
    return recovered;
  }


  function getCancellationTx(runId) {
    const row = db.prepare('SELECT payload FROM job_cancellations WHERE run_id = ?').get(runId);
    return row ? parseJson(row.payload) : null;
  }

  function requireSafeReadOnly(policy, registry, plan, run, resume = false) {
    if (!policy || typeof policy.evaluate !== 'function' ||
        !registry || typeof registry.resolve !== 'function') return false;
    const executor = registry.resolve(plan.jobKind);
    if (!executor || executor.retrySafe !== true ||
        (resume && executor.resumeSafe !== true) ||
        typeof executor.execute !== 'function' || typeof executor.verify !== 'function') return false;
    const result = policy.evaluate({ plan, run, executor, approval: null });
    return Boolean(result && result.allowed === true && result.classification === 'read-only');
  }

  function retryLimits(input) {
    const maxAttempts = input.maxAttempts === undefined ? 3 : input.maxAttempts;
    const delayMs = input.delayMs === undefined ? 1000 : input.delayMs;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5 ||
        !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 3600000) {
      throw new RangeError('read-only retry requires maxAttempts 1..5 and delayMs 0..3600000');
    }
    return { maxAttempts, delayMs };
  }

  function nextReadOnlyRetryTx(row, options, reason, recovering = false) {
    const run = runFromRow(row);
    const { maxAttempts, delayMs } = retryLimits(options);
    if (!['running'].includes(run.status) || getCancellationTx(run.runId) ||
        run.attempt + 1 >= maxAttempts) return null;
    const plan = store.getPlan(run.planHash);
    if (!plan || !requireSafeReadOnly(options.approvalPolicy, options.registry, plan, run, recovering)) return null;
    const when = nowIso();
    const next = jobs.safeCopy({
      ...stripLease(run), status: 'retry-scheduled',
      version: run.version + 1, attempt: run.attempt + 1,
      updatedAt: when, reason,
      retryAt: new Date(Date.parse(when) + delayMs).toISOString()
    });
    writeRunTx(next, run.version, row);
    appendEventTx(run.runId, {
      type: recovering ? 'recovered-read-only' : 'retry-scheduled',
      attempt: next.attempt, retryAt: next.retryAt, reason,
      previousFence: run.lease.fence
    }, when);
    return next;
  }

  function expiredActiveRows(nowMs) {
    const placeholders = ORPHANABLE_LEASE_STATUSES.map(() => '?').join(',');
    return db.prepare(
      'SELECT * FROM job_runs WHERE status IN (' + placeholders + ') AND lease_expires_ms IS NOT NULL AND lease_expires_ms <= ? ORDER BY lease_expires_ms, run_id'
    ).all(...ORPHANABLE_LEASE_STATUSES, nowMs);
  }


  function scheduleId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
      throw new TypeError('scheduleId must be an opaque identifier (1..128 characters)');
    }
    return value;
  }

  function scheduleFromRow(row) {
    if (!row) return null;
    return jobs.safeCopy({ ...parseJson(row.payload),
      enabled: row.enabled === 1, nextDueAt: new Date(row.next_due_ms).toISOString() });
  }

  function scheduleEvent(schedule, type, details = {}, at = nowIso()) {
    db.prepare('INSERT INTO job_schedule_events(schedule_id,created_at,event_type,payload) VALUES (?,?,?,?)')
      .run(schedule,at,type,canonicalJson({ type, ...details }));
  }

  function qualifiedReadOnly(plan, approvalPolicy, registry) {
    if (!plan || plan.policy?.approvalRequired !== false || plan.policy?.readOnly !== true ||
        plan.policy?.hostMutation === true || !approvalPolicy ||
        typeof approvalPolicy.evaluate !== 'function' || !registry ||
        typeof registry.resolve !== 'function') return false;
    const executor = registry.resolve(plan.jobKind);
    if (!executor || executor.retrySafe !== true ||
        typeof executor.execute !== 'function' || typeof executor.verify !== 'function') return false;
    const decision = approvalPolicy.evaluate({plan, run: jobs.createRun(plan)});
    return Boolean(decision && decision.allowed === true && decision.classification === 'read-only');
  }

  const store = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'sqlite-local',
    filename: absolute,
    distributed: false,

    savePlan(plan) {
      assertOpen();
      const normalized = validatePlan(plan);
      const payload = canonicalJson(normalized);
      return transaction(function () {
        db.prepare('INSERT OR IGNORE INTO job_plans(plan_hash, schema_version, payload) VALUES (?, ?, ?)')
          .run(normalized.planHash, normalized.schemaVersion, payload);
        const row = db.prepare('SELECT payload FROM job_plans WHERE plan_hash = ?').get(normalized.planHash);
        if (!row || row.payload !== payload) throw new Error('job plan hash collision or persisted plan mismatch');
        return normalized;
      });
    },

    getPlan(planHash) {
      assertOpen();
      nonEmpty(planHash, 'planHash');
      const row = db.prepare('SELECT payload FROM job_plans WHERE plan_hash = ?').get(planHash);
      return row ? validatePlan(JSON.parse(row.payload)) : null;
    },

    createRun(run, event) {
      assertOpen();
      const normalized = validateRun(run);
      if (normalized.lease) throw new Error('new job run cannot contain lease evidence');
      const createdMs = dateMs(normalized.createdAt, 'job run createdAt');
      return transaction(function () {
        const result = db.prepare(`
          INSERT INTO job_runs(
            run_id, plan_hash, status, version, attempt, created_at, created_ms, updated_at, payload,
            lease_worker_id, lease_fence, lease_expires_at, lease_expires_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL)
        `).run(
          normalized.runId,
          normalized.planHash,
          normalized.status,
          normalized.version,
          normalized.attempt,
          normalized.createdAt,
          createdMs,
          normalized.updatedAt || null,
          canonicalJson(stripLease(normalized))
        );
        if (Number(result.changes) !== 1) throw new Error('job run insertion failed');
        appendEventTx(normalized.runId, event, normalized.createdAt);
        return normalized;
      });
    },

    getRun(runId) {
      assertOpen();
      nonEmpty(runId, 'runId');
      return runFromRow(getRunRow(runId));
    },

    commitTransition(runId, expectedVersion, next, event) {
      assertOpen();
      nonEmpty(runId, 'runId');
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new TypeError('expectedVersion must be a nonnegative safe integer');
      const normalized = validateRun(next);
      if (normalized.runId !== runId) throw new Error('job run identity cannot change');
      if (normalized.version !== expectedVersion + 1) throw new Error('job run transition must increment version exactly once');
      return transaction(function () {
        const current = getRunRow(runId);
        if (!current || Number(current.version) !== expectedVersion) throw new Error('job run version conflict');
        if (current.plan_hash !== normalized.planHash) throw new Error('job run planHash cannot change');
        if (normalized.createdAt !== current.created_at || normalized.attempt !== Number(current.attempt) ||
            normalized.requestedBy !== runFromRow(current).requestedBy) {
          throw new Error('job run immutable identity/attempt/requester cannot change');
        }
        const isCheckpoint = current.status === 'running' && normalized.status === 'running' &&
          event && event.type === 'checkpoint';
        if (!jobs.TRANSITIONS[current.status].includes(normalized.status) && !isCheckpoint) {
          throw new Error('illegal persisted job state transition');
        }
        // Never trust caller-provided updatedAt for lease expiry or fencing authority.
        const transitionAt = nowIso();
        validateLeaseTransition(current, normalized, transitionAt);
        writeRunTx(normalized, expectedVersion, current);
        appendEventTx(runId, event, transitionAt);
        return normalized;
      });
    },

    leaseNextRun(options) {
      assertOpen();
      options = options || {};
      const workerId = nonEmpty(options.workerId, 'workerId');
      const now = nonEmpty(options.now, 'lease now');
      const expiresAt = nonEmpty(options.expiresAt, 'lease expiresAt');
      const nowMs = dateMs(now, 'lease now');
      const expiresMs = dateMs(expiresAt, 'lease expiresAt');
      if (expiresMs <= nowMs) throw new TypeError('lease expiresAt must be after now');

      return transaction(function () {
        requeueExpiredUnstartedTx(now, nowMs);
        const row = db.prepare(
          "SELECT * FROM job_runs WHERE status = 'queued' ORDER BY created_ms, run_id LIMIT 1"
        ).get();
        if (!row) return null;
        const current = runFromRow(row);
        const fence = Number(row.lease_fence) + 1;
        const next = jobs.safeCopy(Object.assign({}, stripLease(current), {
          status: 'leased',
          version: current.version + 1,
          updatedAt: now,
          lease: { workerId: workerId, fence: fence, expiresAt: expiresAt }
        }));
        const result = db.prepare(`
          UPDATE job_runs
             SET status = 'leased',
                 version = ?,
                 updated_at = ?,
                 payload = ?,
                 lease_worker_id = ?,
                 lease_fence = ?,
                 lease_expires_at = ?,
                 lease_expires_ms = ?
           WHERE run_id = ? AND version = ? AND status = 'queued'
        `).run(
          next.version,
          now,
          canonicalJson(stripLease(next)),
          workerId,
          fence,
          expiresAt,
          expiresMs,
          current.runId,
          current.version
        );
        if (Number(result.changes) !== 1) throw new Error('job lease claim conflict');
        appendEventTx(current.runId, {
          type: 'leased',
          workerId: workerId,
          fence: fence,
          expiresAt: expiresAt
        }, now);
        return next;
      });
    },

    renewLease(options) {
      assertOpen();
      options = options || {};
      const runId = nonEmpty(options.runId, 'runId');
      const workerId = nonEmpty(options.workerId, 'workerId');
      if (!Number.isSafeInteger(options.fence) || options.fence < 1) throw new TypeError('fence must be a positive safe integer');
      if (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 0) throw new TypeError('expectedVersion must be a nonnegative safe integer');
      const now = nonEmpty(options.now, 'lease now');
      const expiresAt = nonEmpty(options.expiresAt, 'lease expiresAt');
      const nowMs = dateMs(now, 'lease now');
      const expiresMs = dateMs(expiresAt, 'lease expiresAt');
      if (expiresMs <= nowMs) throw new TypeError('lease expiresAt must be after now');

      return transaction(function () {
        const row = getRunRow(runId);
        if (!row || Number(row.version) !== options.expectedVersion) throw new Error('job run version conflict');
        if (!ACTIVE_LEASE_STATUSES.includes(row.status)) throw new Error('job run does not hold a renewable lease');
        if (row.lease_worker_id !== workerId || Number(row.lease_fence) !== options.fence) throw new Error('matching leased worker identity and fencing token required');
        if (row.lease_expires_ms === null || Number(row.lease_expires_ms) <= Date.parse(nowIso())) throw new Error('job lease has already expired');

        const result = db.prepare(`
          UPDATE job_runs
             SET lease_expires_at = ?, lease_expires_ms = ?
           WHERE run_id = ? AND version = ? AND lease_worker_id = ? AND lease_fence = ?
        `).run(expiresAt, expiresMs, runId, options.expectedVersion, workerId, options.fence);
        if (Number(result.changes) !== 1) throw new Error('job lease renewal conflict');
        appendEventTx(runId, {
          type: 'lease-renewed',
          workerId: workerId,
          fence: options.fence,
          expiresAt: expiresAt
        }, now);
        return runFromRow(getRunRow(runId));
      });
    },

    recoverExpiredLeases(options) {
      assertOpen();
      options = options || {};
      const now = nonEmpty(options.now, 'recovery now');
      const nowMs = dateMs(now, 'recovery now');
      return transaction(function () {
        const requeued = requeueExpiredUnstartedTx(now, nowMs);
        const orphaned = expiredActiveRows(nowMs).map(function (row) {
          const run = runFromRow(row);
          return jobs.safeCopy({
            runId: run.runId,
            status: run.status,
            version: run.version,
            workerId: run.lease.workerId,
            fence: run.lease.fence,
            expiresAt: run.lease.expiresAt
          });
        });
        return jobs.safeCopy({ requeued: requeued, orphaned: orphaned });
      });
    },



    getCancellation(runId) {
      assertOpen();
      nonEmpty(runId, 'runId');
      return getCancellationTx(runId);
    },

    // Caller identity is NOT accepted in the request. A trusted local authorizer
    // supplies the authenticated actor; the transaction also records an audit event.
    requestCancellation(input) {
      assertOpen();
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('cancellation request must be an object');
      const runId = nonEmpty(input.runId, 'runId');
      const reason = nonEmpty(input.reason, 'cancellation reason');
      if (!cancellationAuthorizer) throw new Error('trusted cancellation authorizer is not configured');
      return transaction(function () {
        const row = getRunRow(runId);
        if (!row) throw new Error('cancellation run not found');
        const run = runFromRow(row);
        if (jobs.TERMINAL.includes(run.status)) return jobs.safeCopy({runId, status: run.status});
        const existing = getCancellationTx(runId);
        if (existing) return jobs.safeCopy({runId, status: run.status, requested: true});
        const plan = store.getPlan(run.planHash);
        if (!plan) throw new Error('cancellation plan not found');
        const decision = cancellationAuthorizer(jobs.safeCopy({runId, reason}), run, plan);
        if (!decision || decision.allowed !== true || typeof decision.actorId !== 'string' ||
            !decision.actorId.trim()) throw new Error('cancellation authorizer denied the request');
        const when = nowIso();
        const evidence = jobs.safeCopy({runId, actorId: decision.actorId, reason, requestedAt: when});
        db.prepare('INSERT INTO job_cancellations(run_id,payload) VALUES (?,?)')
          .run(runId, canonicalJson(evidence));
        appendEventTx(runId, {type:'cancellation-requested',actorId:evidence.actorId,reason}, when);
        if (['planned','awaiting-approval','queued','retry-scheduled'].includes(run.status)) {
          const next = jobs.transition(run, 'cancelled', {now:when, reason:'cancelled-before-execution'});
          writeRunTx(next, run.version, row);
          appendEventTx(runId, {type:'status',from:run.status,to:'cancelled',reason:'cancelled-before-execution'}, when);
          return jobs.safeCopy({runId, status:'cancelled'});
        }
        // For leased/running/verifying work, only the owning fenced worker can
        // finish cancellation. In-flight mutating work may require manual repair.
        return jobs.safeCopy({runId, status:run.status, requested:true});
      });
    },

    scheduleReadOnlyRetry(options = {}) {
      assertOpen();
      const runId = nonEmpty(options.runId, 'runId');
      retryLimits(options);
      return transaction(function () {
        const row = getRunRow(runId);
        if (!row || Number(row.version) !== options.expectedVersion)
          throw new Error('retry run version conflict');
        if (row.status !== 'running') return null;
        if (!row.lease_worker_id || row.lease_worker_id !== options.workerId ||
            row.lease_fence !== options.fence ||
            row.lease_expires_ms === null || row.lease_expires_ms <= Date.parse(nowIso())) {
          throw new Error('retry requires current valid worker lease and fencing token');
        }
        return nextReadOnlyRetryTx(row, options, 'qualified-transient-read-only-failure');
      });
    },

    releaseDueRetries(options = {}) {
      assertOpen();
      return transaction(function () {
        const now = nowIso();
        const eligible = db.prepare("SELECT * FROM job_runs WHERE status = 'retry-scheduled' ORDER BY created_ms, run_id").all();
        const released = [];
        for (const row of eligible) {
          const run = runFromRow(row);
          if (!run.retryAt || dateMs(run.retryAt,'retryAt') > Date.parse(now) ||
              getCancellationTx(run.runId)) continue;
          const plan = store.getPlan(run.planHash);
          if (!plan || !requireSafeReadOnly(options.approvalPolicy, options.registry, plan, run)) continue;
          const next = jobs.transition(run, 'queued', {now,reason:'read-only-retry-ready'});
          const updated = jobs.safeCopy(Object.fromEntries(Object.entries(next).filter(([key])=>key!=='retryAt')));
          writeRunTx(updated, run.version, row);
          appendEventTx(run.runId,{type:'retry-released',attempt:run.attempt},now);
          released.push(updated);
        }
        return Object.freeze(released);
      });
    },

    // Opt-in recovery: only previously RUNNING, expired, explicitly replay-safe
    // read-only jobs may be rescheduled. Verifying and mutating jobs remain
    // orphaned for manual reconciliation, never re-executed automatically.
    recoverInterruptedReadOnly(options = {}) {
      assertOpen();
      retryLimits(options);
      return transaction(function () {
        const nowMs = Date.parse(nowIso());
        const recovered = [];
        for (const row of expiredActiveRows(nowMs)) {
          if (row.status !== 'running' || getCancellationTx(row.run_id)) continue;
          const next = nextReadOnlyRetryTx(row, options, 'expired-read-only-lease-reconciled', true);
          if (next) recovered.push(next);
        }
        return Object.freeze(recovered);
      });
    },


    createSchedule(input = {}) {
      assertOpen();
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('schedule input must be an object');
      }
      const id = scheduleId(input.scheduleId);
      const plan = validatePlan(input.plan);
      if (!qualifiedReadOnly(plan, input.approvalPolicy, input.registry)) {
        throw new Error('schedule requires a qualified, explicitly read-only executor and trusted policy');
      }
      const rule = recurrence.validate(input.recurrence);
      const misfirePolicy = input.misfirePolicy === undefined ? 'skip' : input.misfirePolicy;
      if (!['skip','latest'].includes(misfirePolicy)) throw new TypeError('unsupported schedule misfirePolicy');
      if (input.overlapPolicy !== undefined && input.overlapPolicy !== 'forbid') {
        throw new TypeError('only forbid overlapPolicy is supported');
      }
      const maxLatenessMs = input.maxLatenessMs === undefined ? 60000 : input.maxLatenessMs;
      if (!Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0 || maxLatenessMs > 86400000) {
        throw new RangeError('maxLatenessMs must be 0..86400000');
      }
      // Store plan separately from schedule configuration; all changes remain
      // scoped to read-only classified work and an immutable plan hash.
      store.savePlan(plan);
      return transaction(function () {
        const now = nowIso();
        const nextDueMs = recurrence.nextAfter(rule, Date.parse(now)-1);
        const scheduled = jobs.safeCopy({
          scheduleId: id, planHash: plan.planHash, recurrence: rule,
          misfirePolicy, overlapPolicy: 'forbid', maxLatenessMs,
          createdAt: now
        });
        db.prepare(
          'INSERT INTO job_schedules(schedule_id,plan_hash,payload,enabled,next_due_ms) VALUES (?,?,?,1,?)'
        ).run(id,plan.planHash,canonicalJson(scheduled),nextDueMs);
        scheduleEvent(id,'schedule-created',{planHash:plan.planHash,nextDueAt:new Date(nextDueMs).toISOString()},now);
        return jobs.safeCopy({...scheduled,enabled:true,nextDueAt:new Date(nextDueMs).toISOString()});
      });
    },

    getSchedule(id) {
      assertOpen();
      return scheduleFromRow(db.prepare('SELECT * FROM job_schedules WHERE schedule_id = ?').get(scheduleId(id)));
    },

    listSchedules() {
      assertOpen();
      return Object.freeze(db.prepare('SELECT * FROM job_schedules ORDER BY schedule_id').all().map(scheduleFromRow));
    },

    setScheduleEnabled(id, enabled) {
      assertOpen();
      id=scheduleId(id);
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
      return transaction(function () {
        const row=db.prepare('SELECT * FROM job_schedules WHERE schedule_id = ?').get(id);
        if (!row) throw new Error('schedule not found');
        const now=nowIso();
        // Enabling never replays downtime; recompute the next occurrence.
        const nextDueMs=enabled && !row.enabled ?
          recurrence.nextAfter(parseJson(row.payload).recurrence,Date.parse(now)-1) : row.next_due_ms;
        db.prepare('UPDATE job_schedules SET enabled=?, next_due_ms=? WHERE schedule_id=?')
          .run(enabled?1:0,nextDueMs,id);
        scheduleEvent(id,enabled?'schedule-enabled':'schedule-disabled',{},now);
        return store.getSchedule(id);
      });
    },

    listScheduleEvents(id) {
      assertOpen();
      return Object.freeze(db.prepare(
        'SELECT event_id,created_at,event_type,payload FROM job_schedule_events WHERE schedule_id=? ORDER BY event_id'
      ).all(scheduleId(id)).map(row=>jobs.safeCopy({
        ...parseJson(row.payload),eventId:Number(row.event_id),
        type:row.event_type,createdAt:row.created_at
      })));
    },

    dispatchDueSchedules(options = {}) {
      assertOpen();
      const { approvalPolicy, registry } = options;
      const limit = options.limit === undefined ? 20 : options.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('scheduler dispatch limit must be 1..100');
      }
      return transaction(function () {
        const now = nowIso();
        const nowMs = Date.parse(now);
        const due = db.prepare(
          'SELECT * FROM job_schedules WHERE enabled=1 AND next_due_ms<=? ORDER BY next_due_ms,schedule_id LIMIT ?'
        ).all(nowMs,limit);
        const results=[];
        for (const row of due) {
          const schedule = scheduleFromRow(row);
          const plan = store.getPlan(schedule.planHash);
          if (!qualifiedReadOnly(plan,approvalPolicy,registry)) {
            db.prepare('UPDATE job_schedules SET enabled=0 WHERE schedule_id=?').run(schedule.scheduleId);
            scheduleEvent(schedule.scheduleId,'schedule-disabled',{reason:'qualification-lost'},now);
            results.push(jobs.safeCopy({scheduleId:schedule.scheduleId,status:'disabled'}));
            continue;
          }
          const nextDueMs = recurrence.nextAfter(schedule.recurrence,nowMs);
          const lastDueMs = recurrence.previousAtOrBefore(schedule.recurrence,nowMs);
          // At most ONE due occurrence is considered per tick; no backlog floods.
          const candidateMs = schedule.misfirePolicy === 'latest' &&
            lastDueMs !== null && lastDueMs >= row.next_due_ms ? lastDueMs : row.next_due_ms;
          const hasOverlap = Boolean(db.prepare(`
            SELECT 1 FROM job_schedule_occurrences AS occurrence
              JOIN job_runs AS run ON run.run_id=occurrence.run_id
            WHERE occurrence.schedule_id=?
              AND run.status NOT IN ('succeeded','failed','cancelled','blocked')
            LIMIT 1
          `).get(schedule.scheduleId));
          let status='skipped',reason;
          if (hasOverlap) reason='overlap-forbidden';
          else if (nowMs-candidateMs>schedule.maxLatenessMs) reason='misfire-too-late';
          else {
            const runId=crypto.randomUUID();
            const original=jobs.createRun(plan,{
              runId,now,requestedBy:'scheduler:'+schedule.scheduleId
            });
            const withTrigger=jobs.safeCopy({...original,trigger:{
              type:'schedule',scheduleId:schedule.scheduleId,
              scheduledFor:new Date(candidateMs).toISOString(),initiatedAt:now
            }});
            const queued=jobs.transition(withTrigger,'queued',{now,reason:'scheduled-read-only'});
            db.prepare(`
              INSERT INTO job_runs(
                run_id,plan_hash,status,version,attempt,created_at,created_ms,updated_at,payload,
                lease_worker_id,lease_fence,lease_expires_at,lease_expires_ms
              ) VALUES(?,?,?,?,?,?,?,?,?,NULL,0,NULL,NULL)
            `).run(runId,plan.planHash,queued.status,queued.version,queued.attempt,
              queued.createdAt,Date.parse(queued.createdAt),queued.updatedAt,
              canonicalJson(queued));
            db.prepare('INSERT INTO job_schedule_occurrences(schedule_id,scheduled_ms,run_id) VALUES(?,?,?)')
              .run(schedule.scheduleId,candidateMs,runId);
            appendEventTx(runId,{type:'planned',runId,trigger:queued.trigger},now);
            appendEventTx(runId,{type:'status',from:'planned',to:'queued',reason:'scheduled-read-only'},now);
            scheduleEvent(schedule.scheduleId,'run-queued',{runId,scheduledFor:queued.trigger.scheduledFor},now);
            status='queued';
            results.push(jobs.safeCopy({scheduleId:schedule.scheduleId,status,runId,scheduledFor:queued.trigger.scheduledFor}));
          }
          if(status==='skipped') {
            scheduleEvent(schedule.scheduleId,'schedule-skipped',{reason,scheduledFor:new Date(candidateMs).toISOString()},now);
            results.push(jobs.safeCopy({scheduleId:schedule.scheduleId,status,reason}));
          }
          db.prepare('UPDATE job_schedules SET next_due_ms=? WHERE schedule_id=?')
            .run(nextDueMs,schedule.scheduleId);
        }
        return Object.freeze(results);
      });
    },

    getApproval(runId) {

      assertOpen();
      nonEmpty(runId, 'runId');
      const row = db.prepare('SELECT payload FROM job_approvals WHERE run_id = ?').get(runId);
      return row ? parseJson(row.payload) : null;
    },

    // Only a trusted application-local authorization callback can grant approval.
    // Grant and status transition are atomic; caller-controlled plan data cannot
    // satisfy the authorizer or substitute another plan hash/target.
    approveRun(input) {
      assertOpen();
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('approval request must be an object');
      }
      const runId = nonEmpty(input.runId, 'runId');
      const reason = nonEmpty(input.reason, 'approval reason');
      const expiresMs = dateMs(input.expiresAt, 'approval expiresAt');
      if (!approvalAuthorizer) throw new Error('trusted approval authorizer is not configured');

      return transaction(function () {
        const row = getRunRow(runId);
        if (!row) throw new Error('approval run not found');
        const run = runFromRow(row);
        if (run.status !== 'awaiting-approval') throw new Error('approval requires awaiting-approval status');
        if (!run.requestedBy) throw new Error('approval requires a recorded requester');
        const plan = store.getPlan(run.planHash);
        if (!plan || !plan.policy || plan.policy.approvalRequired !== true ||
            plan.policy.readOnly !== false) {
          throw new Error('approval requires an explicit mutating plan');
        }
        if (input.planHash !== plan.planHash || input.targetIdentity !== plan.targetIdentity ||
            input.jobKind !== plan.jobKind) {
          throw new Error('approval plan, target or job kind mismatch');
        }
        const approvedAt = nowIso();
        const approvedMs = Date.parse(approvedAt);
        if (expiresMs <= approvedMs || expiresMs > approvedMs + 86400000) {
          throw new Error('approval expiry must be in the next 24 hours');
        }
        // The approver principal MUST originate from trusted host authentication.
        // Never accept an approverId in the caller-controlled approval request.
        const intent = jobs.safeCopy({
          runId, planHash: plan.planHash, targetIdentity: plan.targetIdentity,
          jobKind: plan.jobKind, reason, expiresAt: new Date(expiresMs).toISOString()
        });
        const decision = approvalAuthorizer(intent, run, plan);
        if (!decision || decision.allowed !== true || typeof decision.approverId !== 'string' ||
            !decision.approverId.trim()) {
          throw new Error('approval authorizer denied the request');
        }
        const approverId = nonEmpty(decision.approverId, 'authenticated approverId');
        if (run.requestedBy === approverId) {
          throw new Error('approval requires a distinct recorded requester and approver');
        }
        const grant = jobs.safeCopy({
          ...intent, approverId, approvedAt
        });
        const inserted = db.prepare(
          'INSERT INTO job_approvals(run_id, plan_hash, payload) VALUES (?, ?, ?)'
        ).run(runId, plan.planHash, canonicalJson(grant));
        if (Number(inserted.changes) !== 1) throw new Error('approval insertion failed');
        const next = jobs.transition(run, 'queued', { now: approvedAt, reason: 'approved' });
        writeRunTx(next, run.version, row);
        appendEventTx(runId, {
          type: 'approval-granted', runId, planHash: plan.planHash,
          approverId, expiresAt: grant.expiresAt
        }, approvedAt);
        return next;
      });
    },

    listEvents(runId) {
      assertOpen();
      nonEmpty(runId, 'runId');
      return Object.freeze(db.prepare(
        'SELECT event_id, sequence, event_type, created_at, payload FROM job_events WHERE run_id = ? ORDER BY sequence'
      ).all(runId).map(function (row) {
        return jobs.safeCopy(Object.assign({}, parseJson(row.payload), {
          eventId: Number(row.event_id),
          sequence: Number(row.sequence),
          createdAt: row.created_at,
          type: row.event_type
        }));
      }));
    },

    close() {
      if (closed) return;
      db.close();
      closed = true;
    }
  };

  return Object.freeze(store);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  createStore
});

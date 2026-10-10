'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jobs = require('./JobKernel');

const SCHEMA_VERSION = 1;
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
  if (!plan || typeof plan !== 'object' || plan.schemaVersion !== jobs.SCHEMA_VERSION || typeof plan.planHash !== 'string') throw new TypeError('valid immutable job plan required');
  const input = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planHash' && key !== 'schemaVersion'));
  const rebuilt = jobs.createPlan(input);
  if (rebuilt.planHash !== plan.planHash) throw new TypeError('job plan hash does not match content');
  return rebuilt;
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
  if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
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

  function expiredActiveRows(nowMs) {
    const placeholders = ORPHANABLE_LEASE_STATUSES.map(() => '?').join(',');
    return db.prepare(
      'SELECT * FROM job_runs WHERE status IN (' + placeholders + ') AND lease_expires_ms IS NOT NULL AND lease_expires_ms <= ? ORDER BY lease_expires_ms, run_id'
    ).all(...ORPHANABLE_LEASE_STATUSES, nowMs);
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
        if (normalized.createdAt !== current.created_at || normalized.attempt !== Number(current.attempt)) {
          throw new Error('job run immutable identity/attempt cannot change');
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

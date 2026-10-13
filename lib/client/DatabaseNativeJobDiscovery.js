'use strict';

// Read-only inspection of engine-native scheduling inventories. No SQL bodies,
// owner identities, credentials, job steps or execution commands are retrieved.
const SCHEMA_VERSION = 1;
const DIALECTS = Object.freeze(['mysql', 'postgresql', 'sqlite', 'sqlserver']);
const MAX_ROWS = 1000;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function dialectOf(client) {
  if (!client || typeof client !== 'object' || typeof client.all !== 'function') {
    throw new TypeError('native job discovery requires a NuBloxSQL-like client');
  }
  let dialect = String(client.dialect || '').trim().toLowerCase();
  if (dialect === 'pg' || dialect === 'postgres') dialect = 'postgresql';
  if (dialect === 'mssql' || dialect === 'sql-server') dialect = 'sqlserver';
  if (!DIALECTS.includes(dialect)) throw new RangeError('unsupported native job discovery dialect: ' + dialect);
  return dialect;
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a nonempty string');
  return value;
}

function flag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new TypeError('native job enabled value must be boolean or 0/1');
}

async function discover(client, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('native job discovery options must be an object');
  }
  const dialect = dialectOf(client);
  const maxRows = options.maxRows === undefined ? 100 : options.maxRows;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) {
    throw new RangeError('native job discovery maxRows must be 1..1000');
  }
  const operation = options.operation === undefined ? {} : options.operation;
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new TypeError('native job discovery operation must be an options object');
  }
  const limit = maxRows + 1;
  let system = null, scope, visibility, limitation, rows = [];
  if (dialect === 'mysql') {
    system = 'mysql-event-scheduler';
    scope = 'server-visible-events';
    visibility = 'permission-scoped';
    limitation = 'Only events visible to the connected principal; scheduler service state, event bodies, definers, executions and cross-server completeness are not established.';
    rows = await client.all(
      'SELECT EVENT_SCHEMA AS schema_name, EVENT_NAME AS event_name, STATUS AS event_status, EVENT_TYPE AS event_type, TIME_ZONE AS event_time_zone FROM information_schema.EVENTS ORDER BY EVENT_SCHEMA, EVENT_NAME LIMIT ' + limit,
      operation
    );
  } else if (dialect === 'sqlserver') {
    system = 'sqlserver-agent';
    scope = 'server-visible-jobs';
    visibility = 'permission-scoped';
    limitation = 'Only SQL Server Agent jobs visible through msdb; Agent service state, job steps, schedules, run history and fleet-wide completeness are not established.';
    rows = await client.all(
      'SELECT TOP (' + limit + ') CAST(job_id AS nvarchar(36)) AS job_id, name AS job_name, enabled AS job_enabled FROM msdb.dbo.sysjobs ORDER BY name, job_id',
      operation
    );
  } else if (dialect === 'postgresql') {
    scope = 'extension-or-external';
    visibility = 'not-inspected';
    limitation = 'PostgreSQL has no core SQL Agent/Event Scheduler inventory. Optional scheduling extensions (for example pg_cron) and external schedulers require separate qualified discovery.';
  } else {
    scope = 'embedded-runtime';
    visibility = 'not-applicable';
    limitation = 'SQLite does not provide a server-native job scheduler. Scheduling belongs to the host application or an external scheduler.';
  }
  if (!Array.isArray(rows)) throw new TypeError('native job discovery requires a row array');
  const truncated = rows.length > maxRows;
  const jobs = rows.slice(0, maxRows).map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('native job discovery returned an invalid row');
    }
    if (dialect === 'mysql') {
      const status = required(row.event_status, 'MySQL event status');
      const type = required(row.event_type, 'MySQL event type');
      if (!['ENABLED', 'DISABLED', 'SLAVESIDE_DISABLED', 'REPLICA_SIDE_DISABLED'].includes(status)) {
        throw new TypeError('unsupported MySQL event status');
      }
      if (!['ONE TIME', 'RECURRING'].includes(type)) throw new TypeError('unsupported MySQL event type');
      return freeze({
        kind: 'mysql-event', schema: required(row.schema_name, 'MySQL event schema'),
        name: required(row.event_name, 'MySQL event name'),
        enabled: status === 'ENABLED', status, scheduleKind: type,
        timeZone: required(row.event_time_zone, 'MySQL event time zone')
      });
    }
    return freeze({
      kind: 'sqlserver-agent-job',
      id: required(row.job_id, 'SQL Server Agent job ID'),
      name: required(row.job_name, 'SQL Server Agent job name'),
      enabled: flag(row.job_enabled)
    });
  });
  return freeze({
    schemaVersion: SCHEMA_VERSION,
    dialect, system, scope, visibility,
    complete: false, limitation,
    jobs, summary: freeze({ count: jobs.length, truncated })
  });
}

module.exports = Object.freeze({ SCHEMA_VERSION, DIALECTS, discover });

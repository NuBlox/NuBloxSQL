'use strict';

// Read-only, permission-scoped inventories of native database schedulers.
// No job definition, owner, credentials, step commands or error messages are read.
const SCHEMA_VERSION = 1;
const DIALECTS = Object.freeze(['mysql', 'postgresql', 'sqlite', 'sqlserver']);
const MAX_ROWS = 1000;
const OUTCOMES = Object.freeze(['failed', 'succeeded', 'retry', 'canceled', 'in-progress']);

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

function integer(value, label) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' ||
      !Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(label + ' must be a nonnegative safe integer');
  }
  return number;
}

function localDateTime(value, label) {
  if (value === null || value === undefined || value === '0000-00-00 00:00:00') return null;
  if (typeof value !== 'string') throw new TypeError(label + ' must be a local date/time string');
  const match = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(value);
  if (!match) throw new TypeError(label + ' must be YYYY-MM-DD HH:mm:ss');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) {
    throw new TypeError(label + ' is out of range');
  }
  return value;
}

function sqlServerLocalDateTime(date, time, label) {
  const day = integer(date, label + ' date');
  const clock = integer(time, label + ' time');
  if (day < 10000101 || day > 99991231 || clock > 235959) {
    throw new TypeError(label + ' date/time is out of range');
  }
  const d = String(day).padStart(8, '0'), t = String(clock).padStart(6, '0');
  return localDateTime(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) +
    ' ' + t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4), label);
}

function mysqlOperational(row) {
  const intervalValue = row.interval_value;
  const intervalField = row.interval_field;
  if (intervalValue !== null && intervalValue !== undefined &&
      (typeof intervalValue !== 'string' && typeof intervalValue !== 'number')) {
    throw new TypeError('MySQL event interval value is invalid');
  }
  if (intervalField !== null && intervalField !== undefined &&
      (typeof intervalField !== 'string' || !/^[A-Z_]{1,40}$/.test(intervalField))) {
    throw new TypeError('MySQL event interval field is invalid');
  }
  return freeze({
    outcome: 'not-reported',
    lastExecutedLocal: localDateTime(row.last_executed_local, 'MySQL last executed'),
    schedule: freeze({
      executeAtLocal: localDateTime(row.execute_at_local, 'MySQL execute at'),
      startsLocal: localDateTime(row.starts_local, 'MySQL starts'),
      endsLocal: localDateTime(row.ends_local, 'MySQL ends'),
      intervalValue: intervalValue === null || intervalValue === undefined ? null : String(intervalValue),
      intervalField: intervalField === undefined ? null : intervalField
    })
  });
}

function sqlServerOperational(row) {
  const scheduleCount = integer(row.schedule_count, 'SQL Server schedule count');
  let nextRunLocal = null;
  if (row.next_run_packed !== null && row.next_run_packed !== undefined) {
    const packed = integer(row.next_run_packed, 'SQL Server next run');
    const date = Math.floor(packed / 1000000), time = packed % 1000000;
    nextRunLocal = sqlServerLocalDateTime(date, time, 'SQL Server next run');
  }
  let lastRun = null;
  if (row.last_run_status !== null && row.last_run_status !== undefined) {
    const code = integer(row.last_run_status, 'SQL Server last run status');
    if (code >= OUTCOMES.length) throw new TypeError('unsupported SQL Server Agent run status');
    const startedLocal = sqlServerLocalDateTime(
      row.last_run_date, row.last_run_time, 'SQL Server last run');
    const duration = integer(row.last_run_duration, 'SQL Server last run duration');
    const minutes = Math.floor(duration / 100) % 100, seconds = duration % 100;
    if (minutes > 59 || seconds > 59) throw new TypeError('SQL Server Agent run duration is invalid');
    const durationSeconds = Math.floor(duration / 10000) * 3600 + minutes * 60 + seconds;
    if (!Number.isSafeInteger(durationSeconds)) throw new TypeError('SQL Server Agent run duration overflow');
    lastRun = freeze({ outcome: OUTCOMES[code], startedLocal, durationSeconds });
  } else if ([row.last_run_date, row.last_run_time, row.last_run_duration].some(v => v !== null && v !== undefined)) {
    throw new TypeError('SQL Server Agent last run history is inconsistent');
  }
  return freeze({
    scheduleCount, nextRunLocal, nextRunMayBeStale: true,
    lastRun, runningStateReliable: false
  });
}

function mysqlSql(limit, includeOperational) {
  const base = 'SELECT EVENT_SCHEMA AS schema_name, EVENT_NAME AS event_name, ' +
    'STATUS AS event_status, EVENT_TYPE AS event_type, TIME_ZONE AS event_time_zone';
  const extra = includeOperational
    ? ", DATE_FORMAT(LAST_EXECUTED, '%Y-%m-%d %H:%i:%s') AS last_executed_local" +
      ", DATE_FORMAT(EXECUTE_AT, '%Y-%m-%d %H:%i:%s') AS execute_at_local" +
      ", DATE_FORMAT(STARTS, '%Y-%m-%d %H:%i:%s') AS starts_local" +
      ", DATE_FORMAT(ENDS, '%Y-%m-%d %H:%i:%s') AS ends_local" +
      ', INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field'
    : '';
  return base + extra +
    ' FROM information_schema.EVENTS ORDER BY EVENT_SCHEMA, EVENT_NAME LIMIT ' + limit;
}

function sqlServerSql(limit, includeOperational) {
  if (!includeOperational) {
    return 'SELECT TOP (' + limit + ') CAST(job_id AS nvarchar(36)) AS job_id, name AS job_name, enabled AS job_enabled FROM msdb.dbo.sysjobs ORDER BY name, job_id';
  }
  return 'SELECT TOP (' + limit + ') CAST(j.job_id AS nvarchar(36)) AS job_id, ' +
    'j.name AS job_name, j.enabled AS job_enabled, h.run_status AS last_run_status, ' +
    'h.run_date AS last_run_date, h.run_time AS last_run_time, ' +
    'h.run_duration AS last_run_duration, s.schedule_count, s.next_run_packed ' +
    'FROM msdb.dbo.sysjobs AS j ' +
    'OUTER APPLY (SELECT TOP (1) hist.run_status, hist.run_date, hist.run_time, hist.run_duration ' +
      'FROM msdb.dbo.sysjobhistory AS hist ' +
      'WHERE hist.job_id = j.job_id AND hist.step_id = 0 ' +
      'ORDER BY hist.instance_id DESC) AS h ' +
    'OUTER APPLY (SELECT COUNT(*) AS schedule_count, ' +
      'MIN(CASE WHEN sch.next_run_date > 0 THEN ' +
      'CAST(sch.next_run_date AS bigint) * 1000000 + sch.next_run_time ELSE NULL END) ' +
      'AS next_run_packed FROM msdb.dbo.sysjobschedules AS sch ' +
      'WHERE sch.job_id = j.job_id) AS s ' +
    'ORDER BY j.name, j.job_id';
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
  const includeOperational = options.includeOperational === undefined ? false : options.includeOperational;
  if (typeof includeOperational !== 'boolean') {
    throw new TypeError('native job discovery includeOperational must be a boolean');
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
    limitation = includeOperational
      ? 'Only visible event schedule and last-start metadata; MySQL EVENTS does not report success/failure, run duration or reliable live service state. Local times must not be interpreted as UTC.'
      : 'Only events visible to the connected principal; scheduler service state, event bodies, definers, executions and cross-server completeness are not established.';
    rows = await client.all(mysqlSql(limit, includeOperational), operation);
  } else if (dialect === 'sqlserver') {
    system = 'sqlserver-agent';
    scope = 'server-visible-jobs';
    visibility = 'permission-scoped';
    limitation = includeOperational
      ? 'Job-level Agent history and schedule data are permission-scoped; history cannot establish current running state and sysjobschedules may lag by 20 minutes. No steps, messages or credentials are retrieved. Local times have no UTC offset.'
      : 'Only SQL Server Agent jobs visible through msdb; Agent service state, job steps, schedules, run history and fleet-wide completeness are not established.';
    rows = await client.all(sqlServerSql(limit, includeOperational), operation);
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
        timeZone: required(row.event_time_zone, 'MySQL event time zone'),
        ...(includeOperational ? { operational: mysqlOperational(row) } : {})
      });
    }
    return freeze({
      kind: 'sqlserver-agent-job',
      id: required(row.job_id, 'SQL Server Agent job ID'),
      name: required(row.job_name, 'SQL Server Agent job name'),
      enabled: flag(row.job_enabled),
      ...(includeOperational ? { operational: sqlServerOperational(row) } : {})
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

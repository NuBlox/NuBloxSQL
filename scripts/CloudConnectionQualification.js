'use strict';

// Opt-in, repository-only read-only managed cloud probe. Not a provider
// connector, authentication token broker, or qualification claim.
const driver = require('..');

const DIALECTS = Object.freeze(['postgresql', 'mysql']);
const PROBE_SQL = 'SELECT 1 AS nublox_cloud_probe';
const TIMEOUT_MS = 10000;

function qualifyError(code) {
  const error = new Error('NuBloxSQL cloud qualification: ' + code);
  error.code = code;
  return error;
}

function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw qualifyError('MISSING_' + key);
  }
  return value;
}

function plan(env, api = driver) {
  const serviceId = required(env, 'NUBLOX_CLOUD_SERVICE');
  const host = required(env, 'NUBLOX_CLOUD_HOST');
  const service = api.cloudDatabaseRegistry.get(serviceId);
  if (!service || service.connectionMethod !== 'direct-tcp' ||
      !DIALECTS.includes(service.existingSqlAdapter)) {
    throw qualifyError('UNSUPPORTED_SERVICE');
  }
  const portText = env.NUBLOX_CLOUD_PORT;
  if (portText !== undefined && !/^[0-9]+$/.test(portText)) {
    throw qualifyError('INVALID_PORT');
  }
  const port = portText === undefined ? service.defaultPort : Number(portText);
  // Delegate endpoint and port validation to the canonical cloud catalogue.
  const hint = api.cloudDatabaseRegistry.planConnection({
    serviceId, endpoint: host, port
  });
  if (hint.status !== 'requires-external-network-auth-and-tls-qualification' ||
      hint.driverHint.dialect !== service.existingSqlAdapter) {
    throw qualifyError('UNSUPPORTED_SERVICE');
  }

  const user = required(env, 'NUBLOX_CLOUD_USER');
  const password = required(env, 'NUBLOX_CLOUD_PASSWORD');
  const database = required(env, 'NUBLOX_CLOUD_DATABASE');
  const servername = env.NUBLOX_CLOUD_SERVERNAME || host;
  // A TCP connection to an IP address cannot establish a trustworthy
  // certificate DNS identity without an explicit peer name.
  if (require('node:net').isIP(servername) ||
      typeof servername !== 'string' || !servername.trim()) {
    throw qualifyError('INVALID_TLS_SERVERNAME');
  }
  const ssl = {
    mode: 'require', rejectUnauthorized: true, servername
  };
  if (env.NUBLOX_CLOUD_CA_PEM !== undefined && env.NUBLOX_CLOUD_CA_PEM !== '') {
    ssl.ca = env.NUBLOX_CLOUD_CA_PEM;
  }
  const config = Object.freeze({
    dialect: service.existingSqlAdapter,
    host: hint.driverHint.host, port: hint.driverHint.port,
    user, password, database, connectTimeout: TIMEOUT_MS,
    ssl: Object.freeze(ssl)
  });
  return Object.freeze({serviceId:service.id, dialect:service.existingSqlAdapter, config});
}

async function run(env, api = driver) {
  const configuration = plan(env, api);
  let connection;
  try {
    connection = api.createConnection(configuration.config);
  } catch (_) {
    throw qualifyError('CREATE_CONNECTION_FAILED');
  }

  let failure;
  try {
    try {
      await connection.connect();
    } catch (_) {
      throw qualifyError('CONNECT_FAILED');
    }
    if (!connection.socket || connection.socket.encrypted !== true ||
        connection.socket.authorized !== true ||
        (configuration.dialect === 'mysql' && connection.secure !== true)) {
      throw qualifyError('TLS_NOT_VERIFIED');
    }
    let result;
    try {
      result = await connection.query(PROBE_SQL, {timeout:TIMEOUT_MS});
    } catch (_) {
      throw qualifyError('READ_ONLY_QUERY_FAILED');
    }
    if (!result || !Array.isArray(result.rows) ||
        result.rows.length !== 1 ||
        String(result.rows[0].nublox_cloud_probe) !== '1') {
      throw qualifyError('READ_ONLY_RESULT_MISMATCH');
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      await connection.end();
    } catch (_) {
      if (!failure) failure = qualifyError('CLOSE_FAILED');
    }
  }
  if (failure) throw failure;

  // Deliberately never print hostnames, usernames, connection options,
  // certificates, passwords or raw vendor errors.
  return Object.freeze({
    schemaVersion: 1, status: 'passed',
    serviceId: configuration.serviceId, dialect: configuration.dialect,
    checks: Object.freeze({
      nativeConnection: 'passed',
      tlsEncryptionAndPeerVerification: 'passed',
      readOnlySqlProbe: 'passed',
      connectionCleanup: 'passed'
    }),
    scope: 'single-live-endpoint-smoke-not-provider-certification'
  });
}

exports.plan = plan;
exports.run = run;
exports.qualifyError = qualifyError;

import {NativePgClient, type NativePgConfig} from './wire.js';

export type InventoryStatus = 'completed' | 'partial';
export type InventoryV1 = {
  schemaVersion: '1.0.0';
  operation: 'database.inspect';
  status: InventoryStatus;
  target: {
    alias: string;
    engineId: 'postgresql';
    engineVersion: string;
    serverVersionNumber: number;
    currentDatabase: string;
    currentPrincipal: string;
  };
  transportSecurity: 'isolated-local' | 'verified-tls';
  capture: {
    capturedAt: string;
    maxDatabases: number;
    truncated: boolean;
    completeness: 'observed-only';
    visibilityRule: 'connect-privilege-and-datallowconn';
  };
  capabilities: {id: string; state: 'supported' | 'unsupported' | 'unknown'; evidence: 'native-observation' | 'version-contract' | 'not-observed'}[];
  databases: {name: string}[];
  warnings: {code: string; message: string}[];
};

export type InspectionCode =
  | 'INVALID_INPUT' | 'UNSUPPORTED_ENGINE' | 'AUTH_FAILED' | 'TLS_UNVERIFIED'
  | 'CONNECT_FAILED' | 'TIMEOUT' | 'CANCELLED' | 'PERMISSION_DENIED'
  | 'DISCOVERY_FAILED' | 'OUTPUT_FAILED';

export class InspectionError extends Error {
  readonly code: InspectionCode;
  readonly retryable: boolean;
  readonly schemaVersion = '1.0.0' as const;
  readonly operation = 'database.inspect' as const;

  constructor(code: InspectionCode, message: string, retryable = false) {
    super(message);
    this.name = 'InspectionError';
    this.code = code;
    this.retryable = retryable;
  }

  toJSON() {
    return {schemaVersion: this.schemaVersion, operation: this.operation,
      code: this.code, message: this.message, retryable: this.retryable};
  }
}

export type PostgresProfile = {
  alias: string;
  engineId: 'postgresql';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  security: 'isolated-local' | 'verified-tls';
  caCertificate?: string;
};
export type InspectOptions = {
  maxDatabases?: number;
  timeoutMs?: number;
};

const IDENTITY = `SELECT current_database() AS current_database,
  current_user AS current_principal,
  current_setting('server_version') AS engine_version,
  current_setting('server_version_num')::integer AS server_version_number`;

const PERMITTED = `SELECT datname::text AS name
  FROM pg_catalog.pg_database
  WHERE datallowconn IS TRUE
    AND has_database_privilege(oid, 'CONNECT') IS TRUE
  ORDER BY datname::text COLLATE "C"
  LIMIT $1`;

function assertProfile(profile: PostgresProfile): void {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new InspectionError('INVALID_INPUT', 'A connection profile is required.');
  }
  const allowed = new Set(['alias','engineId','host','port','database','user','password','security','caCertificate']);
  if (Object.keys(profile).some(key => !allowed.has(key))) {
    throw new InspectionError('INVALID_INPUT', 'The connection profile contains unsupported fields.');
  }
  if (profile.engineId !== 'postgresql') {
    throw new InspectionError('UNSUPPORTED_ENGINE', 'The selected database engine is not supported by this adapter.');
  }
  if (typeof profile.alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(profile.alias) ||
      typeof profile.host !== 'string' || !profile.host ||
      typeof profile.port !== 'number' || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535 ||
      typeof profile.database !== 'string' || !profile.database ||
      typeof profile.user !== 'string' || !profile.user ||
      typeof profile.password !== 'string' || !profile.password) {
    throw new InspectionError('INVALID_INPUT', 'The connection profile is incomplete or invalid.');
  }
  if (profile.security === 'isolated-local') {
    if (profile.host !== '127.0.0.1' && profile.host !== '::1') {
      throw new InspectionError('TLS_UNVERIFIED', 'Unencrypted connections are permitted only to an explicitly isolated loopback fixture.');
    }
  } else if (profile.security !== 'verified-tls') {
    throw new InspectionError('TLS_UNVERIFIED', 'Verified TLS is required for non-local connections.');
  }
  if (profile.caCertificate !== undefined && (typeof profile.caCertificate !== 'string' || !profile.caCertificate)) {
    throw new InspectionError('INVALID_INPUT', 'The provided certificate configuration is invalid.');
  }
}

function cleanFailure(error: unknown): InspectionError {
  if (error instanceof InspectionError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : '';
  if (code === '28P01' || code === '28000') return new InspectionError('AUTH_FAILED', 'Database authentication failed.');
  if (code === '42501') return new InspectionError('PERMISSION_DENIED', 'Database metadata access was denied.');
  if (code === '57014' || code === 'ETIMEDOUT') return new InspectionError('TIMEOUT', 'The database inspection timed out.', true);
  if (['ERR_TLS_CERT_ALTNAME_INVALID','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'].includes(code)) {
    return new InspectionError('TLS_UNVERIFIED', 'Database TLS certificate verification failed.');
  }
  if (['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH','ECONNRESET'].includes(code)) {
    return new InspectionError('CONNECT_FAILED', 'The database connection could not be established.', true);
  }
  return new InspectionError('DISCOVERY_FAILED', 'Database inspection could not be completed.');
}

export async function inspectDatabase(profile: PostgresProfile, options: InspectOptions = {}): Promise<InventoryV1> {
  assertProfile(profile);
  const limit = options.maxDatabases ?? 100;
  const timeout = options.timeoutMs ?? 15000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 ||
      !Number.isInteger(timeout) || timeout < 100 || timeout > 60000) {
    throw new InspectionError('INVALID_INPUT', 'The inspection limits are invalid.');
  }

  const config: NativePgConfig = {
    host: profile.host, port: profile.port, user: profile.user, database: profile.database,
    password: profile.password, ssl: false, connectionTimeoutMillis: timeout, query_timeout: timeout,
    statement_timeout: timeout, application_name: 'nubloxsql-task001'
  };
  if (profile.security === 'verified-tls') {
    config.ssl = {rejectUnauthorized: true, servername: profile.host,
      ...(profile.caCertificate ? {ca: profile.caCertificate} : {})};
  } else {
    config.ssl = false;
  }

  const client = new NativePgClient(config);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(IDENTITY);
    const row = identity.rows[0] as Record<string, unknown> | undefined;
    if (!row || !Number.isInteger(Number(row.server_version_number)) ||
        typeof row.current_database !== 'string' || typeof row.current_principal !== 'string' ||
        typeof row.engine_version !== 'string') {
      throw new InspectionError('DISCOVERY_FAILED', 'Database identity could not be verified.');
    }
    const data = await client.query(PERMITTED, [limit + 1]);
    if (data.rows.some(item => typeof item.name !== 'string')) {
      throw new InspectionError('DISCOVERY_FAILED', 'Database inventory contains invalid metadata.');
    }
    const truncated = data.rows.length > limit;
    const databases = data.rows.slice(0, limit).map(item => ({name: String(item.name)}));
    return {
      schemaVersion: '1.0.0', operation: 'database.inspect', status: truncated ? 'partial' : 'completed',
      target: {alias: profile.alias, engineId: 'postgresql', engineVersion: row.engine_version,
        serverVersionNumber: Number(row.server_version_number), currentDatabase: row.current_database,
        currentPrincipal: row.current_principal},
      transportSecurity: profile.security,
      capture: {capturedAt: new Date().toISOString(), maxDatabases: limit,
        truncated, completeness: 'observed-only', visibilityRule: 'connect-privilege-and-datallowconn'},
      capabilities: [{id: 'postgresql.catalog.database-inspection', state: 'supported', evidence: 'native-observation'}],
      databases, warnings: truncated ? [{code:'RESULT_LIMIT', message:'The inventory was truncated at the configured maximum.'}] : []
    };
  } catch (error) {
    throw cleanFailure(error);
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* Preserve primary outcome; failure is not a credential disclosure. */ }
    } else {
      // Connection failures may leave a socket; NativePgClient.end releases the socket.
      try { await client.end(); } catch { /* Already failed */ }
    }
  }
}

/** PostgreSQL-specific catalogue operations; never part of the public Driver API. */
import type {NativePgClient} from './wire.js';

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

export function queryPostgresqlIdentity(client:NativePgClient) { return client.query(IDENTITY); }
export function queryConnectableDatabases(client:NativePgClient, limit:number) { return client.query(PERMITTED,[limit+1]); }

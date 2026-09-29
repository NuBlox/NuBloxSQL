export * from './index';

export type MySqlClientErrorCategory =
  | 'cancelled'
  | 'connection'
  | 'resource-limit'
  | 'state'
  | 'timeout';

export class MySqlClientError extends Error {
  readonly code: string;
  readonly category: MySqlClientErrorCategory;
  readonly retryable: boolean;
  readonly sqlState: null;
  readonly cause?: unknown;
}

export const ERROR_CODES: Readonly<{
  CONNECTION_NOT_READY: 'NUBLOX_MYSQL_CONNECTION_NOT_READY';
  CONNECTION_CLOSED: 'NUBLOX_MYSQL_CONNECTION_CLOSED';
  ACTIVE_OPERATION: 'NUBLOX_MYSQL_ACTIVE_OPERATION';
  TIMEOUT: 'NUBLOX_MYSQL_TIMEOUT';
  ABORTED: 'NUBLOX_MYSQL_ABORTED';
  POOL_ENDED: 'NUBLOX_MYSQL_POOL_ENDED';
  POOL_QUEUE_LIMIT: 'NUBLOX_MYSQL_POOL_QUEUE_LIMIT';
  POOL_ACQUIRE_TIMEOUT: 'NUBLOX_MYSQL_POOL_ACQUIRE_TIMEOUT';
  POOL_ACQUIRE_ABORTED: 'NUBLOX_MYSQL_POOL_ACQUIRE_ABORTED';
  POOL_CONNECTION_OWNERSHIP: 'NUBLOX_MYSQL_POOL_CONNECTION_OWNERSHIP';
  POOL_CONNECTION_BUSY: 'NUBLOX_MYSQL_POOL_CONNECTION_BUSY';
  TRANSACTION_STATE: 'NUBLOX_MYSQL_TRANSACTION_STATE';
  OPERATION_STATE: 'NUBLOX_MYSQL_OPERATION_STATE';
}>;

export const OBSERVABILITY_CHANNELS: Readonly<{
  connection: 'nublox.mysql.connection';
  statement: 'nublox.mysql.statement';
  pool: 'nublox.mysql.pool';
}>;

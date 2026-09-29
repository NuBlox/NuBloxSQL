export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type SslMode = 'disable' | 'prefer' | 'require';

export interface SslOptions {
  mode?: SslMode;
  servername?: string;
  rejectUnauthorized?: boolean;
  ca?: string | Uint8Array | readonly (string | Uint8Array)[];
  cert?: string | Uint8Array;
  key?: string | Uint8Array;
  minVersion?: string;
  maxVersion?: string;
  [key: string]: unknown;
}

export interface ConnectionConfig {
  host?: string;
  port?: number;
  user: string;
  password?: string;
  database?: string;
  connectTimeout?: number;
  ssl?: boolean | SslMode | SslOptions;
  characterSet?: number;
  maxPacketSize?: number;
  maxPayloadBytes?: number;
  maxRows?: number;
  maxResultBytes?: number;
  maxRowBytes?: number;
  streamHighWaterMark?: number;
  serverPublicKey?: string;
  getServerPublicKey?: boolean;
  signal?: AbortSignalLike;
}

export interface OperationOptions {
  timeout?: number;
  deadline?: number | Date;
  signal?: AbortSignalLike;
}

export interface QueryOptions extends OperationOptions {
  maxRows?: number;
  maxResultBytes?: number;
  maxRowBytes?: number;
}

export interface StreamQueryOptions extends QueryOptions {
  highWaterMark?: number;
}

export interface PoolAcquireOptions {
  timeout?: number;
  deadline?: number | Date;
  signal?: AbortSignalLike;
}

export interface PoolOperationOptions extends OperationOptions {
  acquire?: PoolAcquireOptions;
}

export interface PoolQueryOptions extends QueryOptions {
  acquire?: PoolAcquireOptions;
}

export interface PoolStreamQueryOptions extends StreamQueryOptions {
  acquire?: PoolAcquireOptions;
}

export type IsolationLevel =
  | 'read-uncommitted'
  | 'read-committed'
  | 'repeatable-read'
  | 'serializable';

export interface TransactionOptions extends PoolOperationOptions {
  isolationLevel?: IsolationLevel;
  readOnly?: boolean;
}

export interface PoolConfig extends ConnectionConfig {
  connectionLimit?: number;
  maxIdle?: number;
  idleTimeout?: number;
  acquireTimeout?: number;
  queueLimit?: number;
  resetOnRelease?: boolean;
}

export interface Field {
  catalog: string;
  schema: string;
  table: string;
  originalTable: string;
  name: string;
  originalName: string;
  characterSet: number;
  columnLength: number;
  type: number;
  flags: number;
  decimals: number;
}

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  fields: Field[];
  affectedRows: number | bigint;
  insertId: number | bigint;
  serverStatus: number;
  warningCount: number;
}

export interface StreamCommandResult {
  affectedRows: number | bigint;
  insertId: number | bigint;
  serverStatus: number;
  warningCount: number;
}

export interface ResetResult {
  serverStatus: number;
  warningCount: number;
}

export class MySqlError extends Error {
  readonly code: number | string | null;
  readonly sqlState: string | null;
}

export class MySqlResultLimitError extends RangeError {
  readonly code: string;
  readonly limit: number;
  readonly observed: number;
}

export class ResultStream<Row = Record<string, unknown>> implements AsyncIterable<Row> {
  readonly connection: Connection;
  fields: Field[] | null;
  affectedRows: number | bigint;
  insertId: number | bigint;
  serverStatus: number;
  warningCount: number;
  rowCount: number;
  byteCount: number;

  destroy(error?: Error): this;
  pause(): this;
  resume(): this;
  [Symbol.asyncIterator](): AsyncIterator<Row>;

  on(event: 'data', listener: (row: Row) => void): this;
  on(event: 'fields', listener: (fields: Field[]) => void): this;
  on(event: 'result', listener: (result: StreamCommandResult) => void): this;
  on(event: 'end' | 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  once(event: 'data', listener: (row: Row) => void): this;
  once(event: 'fields', listener: (fields: Field[]) => void): this;
  once(event: 'result', listener: (result: StreamCommandResult) => void): this;
  once(event: 'end' | 'close', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export class PreparedStatement {
  readonly connection: Connection;
  readonly id: number;
  readonly parameterCount: number;
  readonly columnCount: number;
  readonly parameters: Field[];
  readonly columns: Field[];
  readonly warningCount: number;
  closed: boolean;

  execute<Row = Record<string, unknown>>(
    params?: readonly unknown[],
    options?: OperationOptions
  ): Promise<QueryResult<Row>>;
  stream<Row = Record<string, unknown>>(
    params?: readonly unknown[],
    options?: StreamQueryOptions
  ): ResultStream<Row>;
  reset(options?: OperationOptions): Promise<ResetResult>;
  close(): Promise<void>;
}

export class Connection {
  constructor(config: ConnectionConfig);

  readonly config: ConnectionConfig;
  readonly maxRows: number;
  readonly maxResultBytes: number;
  readonly maxRowBytes: number;
  readonly streamHighWaterMark: number;
  connected: boolean;
  ended: boolean;
  secure: boolean;
  server: unknown;
  inTransaction: boolean;

  connect(): Promise<this>;
  query<Row = Record<string, unknown>>(
    sql: string,
    options?: QueryOptions
  ): Promise<QueryResult<Row>>;
  queryStream<Row = Record<string, unknown>>(
    sql: string,
    options?: StreamQueryOptions
  ): ResultStream<Row>;
  prepare(sql: string, options?: OperationOptions): Promise<PreparedStatement>;
  resetSession(options?: OperationOptions): Promise<QueryResult>;

  beginTransaction(options?: TransactionOptions): Promise<this>;
  commit(options?: OperationOptions): Promise<QueryResult>;
  rollback(options?: OperationOptions): Promise<QueryResult>;
  withTransaction<T>(
    fn: (connection: this) => T | Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;
  savepoint(name: string, options?: OperationOptions): Promise<QueryResult>;
  rollbackToSavepoint(name: string, options?: OperationOptions): Promise<QueryResult>;
  releaseSavepoint(name: string, options?: OperationOptions): Promise<QueryResult>;

  end(): Promise<void>;
  destroy(error?: Error): void;

  on(event: 'connect' | 'close' | 'reset', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  once(event: 'connect' | 'close' | 'reset', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export class Pool {
  constructor(config: PoolConfig);

  readonly config: PoolConfig;
  readonly connectionLimit: number;
  readonly maxIdle: number;
  readonly idleTimeout: number;
  readonly acquireTimeout: number;
  readonly queueLimit: number;
  readonly resetOnRelease: boolean;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly resettingCount: number;

  getConnection(options?: PoolAcquireOptions): Promise<Connection>;
  releaseConnection(connection: Connection): void;
  query<Row = Record<string, unknown>>(
    sql: string,
    options?: PoolQueryOptions
  ): Promise<QueryResult<Row>>;
  queryStream<Row = Record<string, unknown>>(
    sql: string,
    options?: PoolStreamQueryOptions
  ): Promise<ResultStream<Row>>;
  execute<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
    options?: PoolOperationOptions
  ): Promise<QueryResult<Row>>;
  withTransaction<T>(
    fn: (connection: Connection) => T | Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;
  end(): Promise<void>;

  on(event: 'connection' | 'acquire' | 'release' | 'evict' | 'reset', listener: (connection: Connection) => void): this;
  on(event: 'resetError', listener: (error: Error, connection: Connection) => void): this;
}

export function createConnection(config: ConnectionConfig): Connection;
export function createPool(config: PoolConfig): Pool;

export const DEFAULT_LIMITS: Readonly<{
  maxRows: number;
  maxResultBytes: number;
  maxRowBytes: number;
  streamHighWaterMark: number;
}>;

export const protocol: Readonly<Record<string, unknown>>;

export type SQLiteValue = null | number | bigint | string | Uint8Array;
export type SQLiteParameters = readonly SQLiteValue[] | Record<string, SQLiteValue>;
export type SQLiteOpenMode = 'readonly' | 'readwrite' | 'readwrite-create';
export type SQLiteJournalMode = 'delete' | 'truncate' | 'persist' | 'memory' | 'wal' | 'off';
export type SQLiteSynchronousMode = 'off' | 'normal' | 'full' | 'extra';
export type SQLiteLockingMode = 'normal' | 'exclusive';
export type SQLiteCheckpointMode = 'passive' | 'full' | 'restart' | 'truncate';

export interface SQLiteCapabilities {
  readonly preparedStatements: true;
  readonly serverSideCursors: false;
  readonly savepoints: true;
  readonly catalogs: false;
  readonly schemas: false;
  readonly transactionalDdl: true;
  readonly queryCancellation: false;
  readonly changeDataCapture: false;
  readonly nativeJson: false;
  readonly multipleActiveResults: false;
}

export interface SQLiteConnectionOptions {
  filename?: string | Buffer | URL;
  mode?: SQLiteOpenMode;
  open?: boolean;
  busyTimeout?: number;
  foreignKeys?: boolean;
  readOnly?: boolean;
  queryOnly?: boolean;
  readBigInts?: boolean;
  productionDefaults?: boolean;
  journalMode?: SQLiteJournalMode;
  synchronous?: SQLiteSynchronousMode;
  lockingMode?: SQLiteLockingMode;
  walAutoCheckpoint?: number;
  cacheSize?: number;
}
export interface SQLiteQueryOptions { readBigInts?: boolean; maxRows?: number; maxRowBytes?: number; maxResultBytes?: number; }
export interface SQLiteFieldMetadata { readonly name: string; readonly nativeType?: string; readonly extension: Readonly<{ database: string | null; table: string | null; column: string | null; }>; }
export interface SQLiteCommandResult { readonly kind: 'command'; readonly affectedRows?: number | bigint; readonly rowCount?: number; readonly insertId?: number | bigint; readonly extension?: unknown; }
export interface SQLiteRowsResult<Row = Record<string, SQLiteValue>> { readonly kind: 'rows'; readonly rows: readonly Row[]; readonly fields: readonly SQLiteFieldMetadata[]; readonly rowCount: number; readonly extension: Readonly<{ resultBytes: number }>; }
export class SqliteError extends Error { readonly code?: string; readonly sqliteCode?: number; readonly category: string; readonly retryable: boolean; readonly cause?: unknown; }
export class SqliteResultLimitError extends SqliteError { readonly limit?: number; readonly observed?: number; }
export class PreparedStatement<Row = Record<string, SQLiteValue>> { columns(): SQLiteFieldMetadata[]; get(parameters?: SQLiteParameters): Row | undefined; run(parameters?: SQLiteParameters): SQLiteCommandResult; iterate(parameters?: SQLiteParameters): IterableIterator<Row>; all(parameters?: SQLiteParameters, options?: SQLiteQueryOptions): SQLiteRowsResult<Row>; }
export interface SQLiteDatabaseInfo { readonly sequence: number | bigint; readonly name: string; readonly file: string | null; }
export interface SQLiteSchemaObject { readonly name: string; readonly type: 'table' | 'view'; readonly tableName: string; readonly rootpage: number | bigint; readonly sql: string | null; }
export interface SQLiteColumnInfo { readonly cid: number | bigint; readonly name: string; readonly type: string; readonly notnull: number | bigint; readonly dflt_value: SQLiteValue; readonly pk: number | bigint; readonly hidden: number | bigint; }
export interface SQLiteBackupOptions { source?: string; target?: string; rate?: number; progress?: (status: { remainingPages: number; totalPages: number }) => void; }
export interface SQLiteLifecycleCapabilities { readonly backup: boolean; readonly serialize: boolean; readonly deserialize: boolean; readonly attach: true; readonly detach: true; readonly explicitOpen: boolean; }
export interface SQLiteStoragePolicy { readonly journalMode?: SQLiteJournalMode; readonly synchronous?: SQLiteSynchronousMode; readonly lockingMode?: SQLiteLockingMode; readonly busyTimeout: number; readonly walAutoCheckpoint?: number; readonly cacheSize?: number; }
export interface SQLiteStorageState { readonly database: string; readonly journalMode: string; readonly synchronous: number; readonly lockingMode: string; readonly busyTimeout: number; readonly walAutoCheckpoint: number; readonly cacheSize: number; readonly pageSize: number; readonly pageCount: number; readonly freelistCount: number; }
export interface SQLiteCheckpointResult { readonly database: string; readonly mode: SQLiteCheckpointMode; readonly busy: number; readonly logFrames: number; readonly checkpointedFrames: number; readonly native: Readonly<Record<string, number | bigint>> | null; }

export interface SQLiteIntegrityCheckOptions { database?: string; maxErrors?: number; }
export interface SQLiteIntegrityCheckResult {
  readonly database: string;
  readonly kind: 'integrity' | 'quick';
  readonly ok: boolean;
  readonly messages: readonly string[];
  readonly native: readonly Readonly<Record<string, SQLiteValue>>[];
}
export interface SQLiteForeignKeyCheckOptions { database?: string; table?: string; }
export interface SQLiteForeignKeyViolation {
  readonly table: string | null;
  readonly rowid: SQLiteValue;
  readonly parent: string | null;
  readonly foreignKeyId: number | null;
  readonly native: Readonly<Record<string, SQLiteValue>>;
}
export interface SQLiteForeignKeyCheckResult { readonly database: string; readonly ok: boolean; readonly violations: readonly SQLiteForeignKeyViolation[]; }
export interface SQLiteAnalyzeOptions { database?: string; target?: string; }
export interface SQLiteAnalyzeResult { readonly database: string; readonly target: string | null; }
export interface SQLiteOptimizeOptions { database?: string; mask?: number; }
export interface SQLiteOptimizeResult { readonly database: string; readonly mask: number | null; readonly native: readonly Readonly<Record<string, SQLiteValue>>[]; }
export interface SQLiteVacuumOptions { database?: string; into?: string; }
export interface SQLiteVacuumResult { readonly database: string; readonly into: string | null; }
export interface SQLiteIncrementalVacuumResult { readonly database: string; readonly pages: number | null; }

export class Connection {
  readonly filename: string | Buffer | URL;
  readonly mode: SQLiteOpenMode;
  readonly readBigInts: boolean;
  closed: boolean;
  constructor(config?: SQLiteConnectionOptions);
  open(): void;
  close(): void;
  exec(sql: string): SQLiteCommandResult;
  prepare<Row = Record<string, SQLiteValue>>(sql: string, options?: SQLiteQueryOptions): PreparedStatement<Row>;
  query<Row = Record<string, SQLiteValue>>(sql: string, parameters?: SQLiteParameters, options?: SQLiteQueryOptions): SQLiteRowsResult<Row>;
  run(sql: string, parameters?: SQLiteParameters, options?: SQLiteQueryOptions): SQLiteCommandResult;
  begin(mode?: 'deferred' | 'immediate' | 'exclusive'): SQLiteCommandResult;
  commit(): SQLiteCommandResult;
  rollback(): SQLiteCommandResult;
  savepoint(name: string): SQLiteCommandResult;
  release(name: string): SQLiteCommandResult;
  rollbackTo(name: string): SQLiteCommandResult;
  transaction<T>(fn: (connection: Connection) => T, options?: { mode?: 'deferred' | 'immediate' | 'exclusive' }): T;
  isTransaction(): boolean;
  listDatabases(): SQLiteDatabaseInfo[];
  listTables(database?: string): readonly SQLiteSchemaObject[];
  tableInfo(name: string, database?: string): readonly SQLiteColumnInfo[];
  attach(filename: string | URL, name: string): Readonly<{ name: string; file: string }>;
  detach(name: string): void;
  backup(destination: string | Buffer | URL, options?: SQLiteBackupOptions): Promise<number>;
  serialize(database?: string): Uint8Array;
  deserialize(buffer: Uint8Array, options?: { database?: string; dbName?: string }): void;
  lifecycleCapabilities(): SQLiteLifecycleCapabilities;
  storagePolicy(): SQLiteStoragePolicy;
  storageState(database?: string): SQLiteStorageState;
  checkpoint(mode?: SQLiteCheckpointMode, database?: string): SQLiteCheckpointResult;
  integrityCheck(options?: SQLiteIntegrityCheckOptions): SQLiteIntegrityCheckResult;
  quickCheck(options?: SQLiteIntegrityCheckOptions): SQLiteIntegrityCheckResult;
  foreignKeyCheck(options?: SQLiteForeignKeyCheckOptions): SQLiteForeignKeyCheckResult;
  analyze(options?: SQLiteAnalyzeOptions): SQLiteAnalyzeResult;
  optimize(options?: SQLiteOptimizeOptions): SQLiteOptimizeResult;
  vacuum(options?: SQLiteVacuumOptions): SQLiteVacuumResult;
  incrementalVacuum(pages?: number, database?: string): SQLiteIncrementalVacuumResult;
}

export const capabilities: Readonly<SQLiteCapabilities>;
export const services: Readonly<{ quoteIdentifier(identifier: string): string; placeholder(index: number): '?'; }>;
export const descriptor: Readonly<{ identity: Readonly<{ family: 'sqlite'; name: 'SQLite' }>; capabilities: Readonly<SQLiteCapabilities>; services: typeof services; supports(capability: string): boolean; }>;
export function createObjectName(name: { catalog?: string; schema?: string; name: string }): Readonly<{ catalog?: string; schema?: string; name: string }>;
export function createConnection(config?: SQLiteConnectionOptions): Connection;

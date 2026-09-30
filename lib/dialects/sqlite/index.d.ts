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
  allowExtension?: boolean;
  extensionAllowlist?: readonly string[];
}
export interface SQLiteQueryOptions { readBigInts?: boolean; maxRows?: number; maxRowBytes?: number; maxResultBytes?: number; }
export interface SQLiteFieldMetadata { readonly name: string; readonly nativeType?: string; readonly extension: Readonly<{ database: string | null; table: string | null; column: string | null; }>; }
export interface SQLiteCommandResult { readonly kind: 'command'; readonly affectedRows?: number | bigint; readonly rowCount?: number; readonly insertId?: number | bigint; readonly extension?: unknown; }
export interface SQLiteRowsResult<Row = Record<string, SQLiteValue>> { readonly kind: 'rows'; readonly rows: readonly Row[]; readonly fields: readonly SQLiteFieldMetadata[]; readonly rowCount: number; readonly extension: Readonly<{ resultBytes: number }>; }
export class SqliteError extends Error { readonly code?: string; readonly sqliteCode?: number; readonly category: string; readonly retryable: boolean; readonly cause?: unknown; }
export class SqliteResultLimitError extends SqliteError { readonly limit?: number; readonly observed?: number; }

export interface SQLiteStatementMetadataOptions { includeSql?: boolean; includeExpandedSql?: boolean; }
export interface SQLiteStatementMetadata {
  readonly columns: readonly SQLiteFieldMetadata[];
  readonly readBigInts: boolean;
  readonly native: Readonly<{ sourceSql: boolean; expandedSql: boolean }>;
  readonly sourceSql?: string;
  readonly expandedSql?: string;
}
export class PreparedStatement<Row = Record<string, SQLiteValue>> {
  columns(): SQLiteFieldMetadata[];
  metadata(options?: SQLiteStatementMetadataOptions): SQLiteStatementMetadata;
  get(parameters?: SQLiteParameters): Row | undefined;
  run(parameters?: SQLiteParameters): SQLiteCommandResult;
  iterate(parameters?: SQLiteParameters): IterableIterator<Row>;
  all(parameters?: SQLiteParameters, options?: SQLiteQueryOptions): SQLiteRowsResult<Row>;
}

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
export interface SQLiteExtensibilityCapabilities { readonly scalarFunctions: boolean; readonly aggregates: boolean; readonly extensionLoading: boolean; readonly authorizer: boolean; readonly defensive: boolean; }
export interface SQLiteExtensionPolicy { readonly enabled: boolean; readonly allowlist: readonly string[]; }
export interface SQLiteFunctionOptions { deterministic?: boolean; directOnly?: boolean; useBigIntArguments?: boolean; varargs?: boolean; }
export interface SQLiteAggregateOptions<State = unknown> {
  start?: State | (() => State);
  step: (state: State, ...values: SQLiteValue[]) => State;
  result?: (state: State) => SQLiteValue;
  inverse?: (state: State, ...values: SQLiteValue[]) => State;
  deterministic?: boolean;
  directOnly?: boolean;
  useBigIntArguments?: boolean;
  varargs?: boolean;
}
export type SQLiteAuthorizer = (actionCode: number, arg1: string | null, arg2: string | null, dbName: string | null, triggerOrView: string | null) => number;

export interface SQLiteFeatureFlags {
  readonly commonTableExpressions: boolean;
  readonly windowFunctions: boolean;
  readonly returning: boolean;
  readonly upsert: boolean;
  readonly json: boolean;
  readonly jsonb: boolean;
  readonly strictTables: boolean;
  readonly fts5: boolean;
  readonly builtInCollations: boolean;
  readonly customCollations: boolean;
}
export interface SQLiteValueConventions {
  readonly null: 'null';
  readonly integer: 'bigint' | 'number-safe-integer';
  readonly real: 'number';
  readonly text: 'string';
  readonly blob: 'Uint8Array';
  readonly boolean: 'integer-0-or-1-by-convention';
  readonly dateTime: 'ISO-8601-UTC-text-by-convention';
  readonly json: 'JSON-text-or-JSONB-blob' | 'JSON-text' | 'text-only';
}
export interface SQLiteFeatureMatrix {
  readonly sqliteVersion: string;
  readonly features: Readonly<SQLiteFeatureFlags>;
  readonly compileOptions: readonly string[];
  readonly valueConventions: Readonly<SQLiteValueConventions>;
}

export type SQLiteQueryPlanNodeKind = 'scan' | 'search' | 'temp-btree' | 'multi-index' | 'subquery' | 'other';
export interface SQLiteQueryPlanNode {
  readonly id: number;
  readonly parentId: number;
  readonly auxiliary: number;
  readonly detail: string;
  readonly kind: SQLiteQueryPlanNodeKind;
  readonly table: string | null;
  readonly index: string | null;
  readonly covering: boolean;
  readonly automaticIndex: boolean;
  readonly tempBtree: boolean;
}
export interface SQLiteQueryPlanSummary {
  readonly nodeCount: number;
  readonly scans: number;
  readonly searches: number;
  readonly usesIndex: boolean;
  readonly usesCoveringIndex: boolean;
  readonly usesAutomaticIndex: boolean;
  readonly hasFullScan: boolean;
  readonly usesTempBtree: boolean;
}
export interface SQLitePlannerWarning { readonly code: 'full-table-scan' | 'temporary-btree' | 'automatic-index'; readonly message: string; readonly nodeId: number | null; }
export interface SQLiteQueryPlan { readonly nodes: readonly SQLiteQueryPlanNode[]; readonly summary: SQLiteQueryPlanSummary; readonly warnings: readonly SQLitePlannerWarning[]; }
export interface SQLiteExplainOpcode { readonly address: number; readonly opcode: string; readonly p1: number; readonly p2: number; readonly p3: number; readonly p4: string | null; readonly p5: number; readonly comment: string | null; }
export interface SQLiteExplainResult { readonly opcodes: readonly SQLiteExplainOpcode[]; readonly opcodeCount: number; readonly uniqueOpcodes: readonly string[]; }
export interface SQLiteQueryDiagnosisOptions extends SQLiteStatementMetadataOptions { includeOpcodes?: boolean; }
export interface SQLiteQueryDiagnosis { readonly statement: SQLiteStatementMetadata; readonly plan: SQLiteQueryPlan; readonly explain?: SQLiteExplainResult; }

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
  extensibilityCapabilities(): SQLiteExtensibilityCapabilities;
  createFunction(name: string, fn: (...values: SQLiteValue[]) => SQLiteValue): Readonly<{ name: string; kind: 'scalar' }>;
  createFunction(name: string, options: SQLiteFunctionOptions, fn: (...values: SQLiteValue[]) => SQLiteValue): Readonly<{ name: string; kind: 'scalar' }>;
  createAggregate<State = unknown>(name: string, options: SQLiteAggregateOptions<State>): Readonly<{ name: string; kind: 'aggregate' }>;
  enableExtensionLoading(active: boolean): boolean;
  loadExtension(filename: string, entryPoint?: string): Readonly<{ path: string; entryPoint: string | null }>;
  setAuthorizer(callback: SQLiteAuthorizer | null): boolean;
  setDefensive(active: boolean): boolean;
  authorizerConstants(): Readonly<Record<string, number>>;
  extensionPolicy(): SQLiteExtensionPolicy;
  featureMatrix(): SQLiteFeatureMatrix;
  valueConventions(): Readonly<SQLiteValueConventions>;
  explainQueryPlan(sql: string, parameters?: SQLiteParameters): SQLiteQueryPlan;
  explain(sql: string, parameters?: SQLiteParameters): SQLiteExplainResult;
  diagnoseQuery(sql: string, parameters?: SQLiteParameters, options?: SQLiteQueryDiagnosisOptions): SQLiteQueryDiagnosis;
}

export const capabilities: Readonly<SQLiteCapabilities>;
export const services: Readonly<{ quoteIdentifier(identifier: string): string; placeholder(index: number): '?'; }>;
export const descriptor: Readonly<{ identity: Readonly<{ family: 'sqlite'; name: 'SQLite' }>; capabilities: Readonly<SQLiteCapabilities>; services: typeof services; supports(capability: string): boolean; }>;
export function createObjectName(name: { catalog?: string; schema?: string; name: string }): Readonly<{ catalog?: string; schema?: string; name: string }>;
export function createConnection(config?: SQLiteConnectionOptions): Connection;

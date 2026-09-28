declare namespace mysql {
  type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  type PreparedInt64Input = number | bigint | string;
  type PreparedBitInput = number | bigint | string | Buffer | Uint8Array;
  type CompressionAlgorithm = 'zlib' | 'zstd' | 'uncompressed';
  type TlsPolicy = 'modern' | 'strict';
  type QueryAttributeValue = string | number | bigint | boolean | Date | Buffer | null;
  type SessionStateChangeName =
    | 'system_variables'
    | 'schema'
    | 'state_change'
    | 'gtids'
    | 'transaction_characteristics'
    | 'transaction_state'
    | 'unknown';

  interface AbortSignalLike {
    readonly aborted: boolean;
    readonly reason?: unknown;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }

  interface AuthPluginContext {
    readonly config: ConnectionOptions;
    readonly pluginName: string;
    readonly secure: boolean;
  }

  interface AuthPluginStep {
    readonly phase: 'initial' | 'continue';
    readonly pluginName: string;
    readonly secure: boolean;
    readonly step: number;
  }

  type AuthPluginHandler = (
    data: Buffer,
    step: AuthPluginStep
  ) => Buffer | null | undefined | Promise<Buffer | null | undefined>;
  type AuthPluginFactory = (context: AuthPluginContext) => AuthPluginHandler;

  interface CredentialProviderContext {
    readonly host: string;
    readonly port: number;
    readonly socketPath?: string;
    readonly user?: string;
    readonly database?: string;
    readonly secure: boolean;
  }

  interface ResolvedCredentials {
    password: string;
    user?: string;
    database?: string;
  }

  type CredentialProvider = (
    context: Readonly<CredentialProviderContext>
  ) => string | ResolvedCredentials | Promise<string | ResolvedCredentials>;

  interface SslOptions {
    ca?: string | Buffer | Array<string | Buffer>;
    cert?: string | Buffer;
    key?: string | Buffer;
    passphrase?: string;
    ciphers?: string;
    minVersion?: string;
    maxVersion?: string;
    rejectUnauthorized?: boolean;
  }

  interface ConnectionOptions {
    host?: string;
    port?: number;
    localAddress?: string;
    socketPath?: string;
    user?: string;
    password?: string;
    database?: string;
    connectTimeout?: number;
    charset?: string;
    timezone?: string;
    ssl?: string | SslOptions | false;
    tlsPolicy?: TlsPolicy;
    localInfile?: boolean;
    multipleStatements?: boolean;
    namedPlaceholders?: boolean;
    supportBigNumbers?: boolean;
    bigNumberStrings?: boolean;
    dateStrings?: boolean | string[];
    trace?: boolean;
    typeCast?: boolean | Function;
    queryFormat?: Function;
    Promise?: PromiseConstructor;
    authPlugins?: Record<string, AuthPluginFactory>;
    defaultAuthPlugin?: string;
    credentialProvider?: CredentialProvider;
    allowPublicKeyRetrieval?: boolean;
    serverPublicKey?: string | Buffer;
    onServerPublicKey?: (key: string | Buffer) => void;
    maxPreparedStatements?: number;
    maxInboundPacketSize?: number;
    maxFieldSize?: number;
    maxMetadataSize?: number;
    maxResultSetColumns?: number;
    maxRowSize?: number;
    maxBufferedRows?: number;
    maxResultSetSize?: number;
    compressionAlgorithms?: CompressionAlgorithm | CompressionAlgorithm[];
    zstdCompressionLevel?: number;
    compress?: boolean;
  }

  interface PoolOptions extends ConnectionOptions {
    acquireTimeout?: number;
    waitForConnections?: boolean;
    connectionLimit?: number;
    queueLimit?: number;
    minimumIdle?: number;
    maintainMinimumIdle?: boolean;
    minimumIdleRetryDelayMs?: number;
    minimumIdleMaxRetryDelayMs?: number;
    minimumIdleRetryJitter?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerCooldownMs?: number;
    circuitBreakerHalfOpenMaxAttempts?: number;
    admissionControl?: PoolAdmissionControl;
  }

  interface PoolClusterNodeMetadata {
    role?: string;
    replicationState?: string;
    priority?: number;
    weight?: number;
    tags?: Record<string, unknown>;
  }

  interface PoolClusterNodeSnapshot {
    readonly id: string;
    readonly host?: string;
    readonly port?: number;
    readonly socketPath?: string;
    readonly online: boolean;
    readonly offlineUntil: number;
    readonly errorCount: number;
    readonly role: string;
    readonly replicationState: string;
    readonly priority: number;
    readonly weight: number;
    readonly tags: Readonly<Record<string, unknown>>;
  }

  interface PoolTopologyPolicyContext {
    readonly operation: 'connection' | 'query';
    readonly pattern: string | RegExp;
    readonly sql?: string;
  }

  type PoolTopologyPolicy = (
    candidates: ReadonlyArray<Readonly<PoolClusterNodeSnapshot>>,
    context: Readonly<PoolTopologyPolicyContext>
  ) => string | PoolClusterNodeSnapshot | null | undefined;

  interface PoolTopologyUpdate extends PoolClusterNodeMetadata {
    id: string;
  }

  type PoolTopologyProvider = (
    current: ReadonlyArray<Readonly<PoolClusterNodeSnapshot>>
  ) => PoolTopologyUpdate[] | Promise<PoolTopologyUpdate[]>;

  interface PoolClusterOptions {
    canRetry?: boolean;
    defaultSelector?: string;
    removeNodeErrorCount?: number;
    restoreNodeTimeout?: number;
    topologyPolicy?: PoolTopologyPolicy;
    topologyProvider?: PoolTopologyProvider;
  }

  interface PoolNamespace {
    getConnection(callback: (error: Error | null, connection?: Connection) => void): void;
    query(sql: string | QueryOptions, values?: unknown[] | Record<string, unknown>, callback?: Function): Query;
  }

  interface PoolCluster {
    add(config: PoolOptions, metadata?: PoolClusterNodeMetadata): void;
    add(id: string, config: PoolOptions, metadata?: PoolClusterNodeMetadata): void;
    of(pattern?: string | RegExp, selector?: string): PoolNamespace;
    remove(pattern: string | RegExp): void;
    getConnection(callback: (error: Error | null, connection?: Connection) => void): void;
    getConnection(pattern: string | RegExp, callback: (error: Error | null, connection?: Connection) => void): void;
    getConnection(pattern: string | RegExp, selector: string, callback: (error: Error | null, connection?: Connection) => void): void;
    setNodeMetadata(id: string, metadata: PoolClusterNodeMetadata): this;
    topology(): PoolClusterNodeSnapshot[];
    refreshTopology(callback?: (error: Error | null, topology?: PoolClusterNodeSnapshot[]) => void): Promise<PoolClusterNodeSnapshot[]>;
    end(callback?: (error?: Error) => void): void;
    on(event: 'topology' | 'topologyRefresh', listener: (topology: PoolClusterNodeSnapshot[]) => void): this;
    on(event: 'topologyRefreshError', listener: (error: Error) => void): this;
    on(event: 'online' | 'offline' | 'remove', listener: (nodeId: string) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  interface QueryOptions {
    sql: string;
    values?: unknown[] | Record<string, unknown>;
    attributes?: Record<string, QueryAttributeValue>;
    timeout?: number;
    operationTimeout?: number;
    nestTables?: boolean | string;
    typeCast?: boolean | Function;
    signal?: AbortSignalLike;
    namedPlaceholders?: boolean;
  }

  interface ExecuteOptions {
    sql: string;
    values?: unknown[] | Record<string, unknown>;
    attributes?: Record<string, QueryAttributeValue>;
    timeout?: number;
    operationTimeout?: number;
    nestTables?: boolean | string;
    typeCast?: boolean | Function;
    signal?: AbortSignalLike;
    namedPlaceholders?: boolean;
  }

  interface PrepareOptions {
    sql: string;
    timeout?: number;
    nestTables?: boolean | string;
    typeCast?: boolean | Function;
  }

  interface ResetConnectionOptions {
    timeout?: number;
    operationTimeout?: number;
    signal?: AbortSignalLike;
  }

  interface StreamOptions {
    highWaterMark?: number;
    emitClose?: boolean;
    autoDestroy?: boolean;
  }

  interface TypedPreparedParameter<T = unknown> {
    readonly type: number;
    readonly unsigned: boolean;
    readonly value: T;
  }

  interface PreparedParameterFactory {
    int8(value: number): TypedPreparedParameter<number>;
    uint8(value: number): TypedPreparedParameter<number>;
    int16(value: number): TypedPreparedParameter<number>;
    uint16(value: number): TypedPreparedParameter<number>;
    int32(value: number): TypedPreparedParameter<number>;
    uint32(value: number): TypedPreparedParameter<number>;
    int64(value: PreparedInt64Input): TypedPreparedParameter<bigint>;
    uint64(value: PreparedInt64Input): TypedPreparedParameter<bigint>;
    float(value: number): TypedPreparedParameter<number>;
    double(value: number): TypedPreparedParameter<number>;
    decimal(value: number | bigint | string): TypedPreparedParameter<string>;
    text(value: string): TypedPreparedParameter<string>;
    binary(value: Buffer | Uint8Array): TypedPreparedParameter<Buffer>;
    bit(value: PreparedBitInput): TypedPreparedParameter<Buffer>;
    year(value: number): TypedPreparedParameter<number>;
    date(value: Date | string): TypedPreparedParameter<unknown>;
    datetime(value: Date | string): TypedPreparedParameter<unknown>;
    timestamp(value: Date | string): TypedPreparedParameter<unknown>;
    time(value: string): TypedPreparedParameter<unknown>;
    json(value: unknown): TypedPreparedParameter<string>;
  }

  interface FieldInfo {
    name?: string;
    table?: string;
    db?: string;
    type?: number;
    length?: number;
    flags?: number;
    charsetNr?: number;
  }

  interface SessionStateChange {
    type: number;
    name: SessionStateChangeName;
    values: Array<string | null>;
    data: Buffer;
    variable?: string | null;
    value?: string | null;
    encoding?: number;
  }

  interface SessionStateUnknownChange {
    type: number;
    data: Buffer;
  }

  interface SessionStateSnapshot {
    version: number;
    schema: string | null;
    systemVariables: Record<string, string | null>;
    stateChanged: string | null;
    gtids: string | null;
    gtidEncoding: number | null;
    transactionCharacteristics: string | null;
    transactionState: string | null;
    unknown: SessionStateUnknownChange[];
  }

  interface OkPacket {
    fieldCount?: number;
    affectedRows?: number;
    changedRows?: number;
    insertId?: number;
    serverStatus?: number;
    warningCount?: number;
    message?: string;
    sessionStateChanges: SessionStateChange[];
  }

  type Row = Record<string, unknown>;
  type QueryResult = Row[] | OkPacket | Array<Row[] | OkPacket>;
  type QueryFields = FieldInfo[] | FieldInfo[][] | undefined;
  type QueryTuple<T = QueryResult> = [T, QueryFields];

  interface AsyncRowStream<T = Row> extends AsyncIterable<T> {
    readonly readableHighWaterMark: number;
    readonly readableObjectMode: boolean;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  interface TransactionOptions {
    isolationLevel?: IsolationLevel;
    readOnly?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
    maxRetryDelayMs?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  }

  interface CircuitBreakerStats {
    enabled: boolean;
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    threshold: number;
    cooldownMs: number;
    retryAfterMs: number;
    halfOpenInFlight: number;
    halfOpenLimit: number;
    totalOpened: number;
    totalRejected: number;
    totalRecoveries: number;
  }

  interface PoolAdmissionSnapshot {
    total: number;
    active: number;
    idle: number;
    acquiring: number;
    queued: number;
    limit: number;
    queueLimit: number;
    minimumIdle: number;
    utilization: number | null;
    saturated: boolean;
    circuitBreaker: CircuitBreakerStats | null;
  }

  interface PoolAdmissionDecision {
    allow: boolean;
    reason?: string;
    retryAfterMs?: number;
  }

  type PoolAdmissionControl = (
    snapshot: Readonly<PoolAdmissionSnapshot>
  ) => boolean | PoolAdmissionDecision;

  interface AdmissionStats {
    enabled: boolean;
    evaluated: number;
    admitted: number;
    rejected: number;
    errors: number;
  }

  interface PoolStats {
    total: number;
    active: number;
    idle: number;
    acquiring: number;
    queued: number;
    limit: number;
    minimumIdle: number;
    queueLimit: number;
    closed: boolean;
    utilization: number | null;
    saturated: boolean;
  }

  interface PoolWarmupResult {
    target: number;
    created: number;
    idle: number;
    total: number;
    limited: boolean;
  }

  interface HealthCheckResult {
    ok: boolean;
    latencyMs: number;
    errorCode?: string;
    pool: PoolStats;
  }

  interface PreparedStatementCacheStats {
    limit: number;
    size: number;
    hits: number;
    misses: number;
    hitRate: number | null;
    prepares: number;
    evictions: number;
    invalidations: number;
    reprepares: number;
  }

  interface PreparedStatement {
    readonly id: number;
    readonly query: string;
    readonly sql: string;
    readonly columns: FieldInfo[];
    readonly parameters: FieldInfo[];
    readonly numColumns: number;
    readonly numParams: number;
    execute<T = QueryResult>(values?: unknown[], callback?: (error: Error | null, rows?: T, fields?: QueryFields) => void): unknown;
    reset(callback?: (error?: Error | null) => void): this;
    close(): this;
  }

  interface PromisePreparedStatement {
    readonly statement: PreparedStatement;
    readonly id: number;
    readonly query: string;
    readonly columns: FieldInfo[];
    readonly parameters: FieldInfo[];
    execute<T = QueryResult>(values?: unknown[]): Promise<QueryTuple<T>>;
    reset(): Promise<void>;
    close(): Promise<void>;
  }

  interface Query {
    stream(options?: StreamOptions): AsyncRowStream;
  }

  interface Connection {
    threadId: number | null;
    state: string;
    config: ConnectionOptions;
    connect(callback?: (error?: Error) => void): void;
    query(sql: string | QueryOptions, values?: unknown[] | Record<string, unknown>, callback?: Function): Query;
    execute(sql: string | ExecuteOptions, values?: unknown[] | Record<string, unknown>, callback?: Function): unknown;
    prepare(sql: string | PrepareOptions, callback?: (error: Error | null, statement?: PreparedStatement) => void): unknown;
    unprepare(sql: string): this;
    clearPreparedStatementCache(): this;
    preparedStatementCacheStats(): PreparedStatementCacheStats;
    sessionStateSnapshot(): SessionStateSnapshot;
    resetConnection(options?: ResetConnectionOptions, callback?: (error: Error | null, packet?: OkPacket) => void): unknown;
    beginTransaction(options?: object, callback?: Function): Query;
    commit(options?: object, callback?: Function): Query;
    rollback(options?: object, callback?: Function): Query;
    end(options?: object, callback?: Function): void;
    destroy(): void;
    escape(value: unknown): string;
    escapeId(value: unknown): string;
    format(sql: string, values?: unknown[]): string;
    promise(PromiseImpl?: PromiseConstructor): PromiseConnection;
  }

  interface Pool {
    getConnection(callback: (error: Error | null, connection?: Connection) => void): void;
    warmup(count?: number, callback?: (error: Error | null, result?: PoolWarmupResult) => void): void;
    query(sql: string | QueryOptions, values?: unknown[] | Record<string, unknown>, callback?: Function): Query;
    execute(sql: string | ExecuteOptions, values?: unknown[] | Record<string, unknown>, callback?: Function): unknown;
    circuitBreakerStats(): CircuitBreakerStats;
    admissionStats(): AdmissionStats;
    end(callback?: (error?: Error) => void): void;
    escape(value: unknown): string;
    escapeId(value: unknown): string;
    promise(PromiseImpl?: PromiseConstructor): PromisePool;
  }

  interface PromiseConnection {
    readonly connection: Connection;
    readonly threadId: number | null;
    readonly state: string;
    readonly config: ConnectionOptions;
    connect(options?: object): Promise<this>;
    query<T = QueryResult>(sql: string | QueryOptions, values?: unknown[] | Record<string, unknown>): Promise<QueryTuple<T>>;
    execute<T = QueryResult>(sql: string | ExecuteOptions, values?: unknown[] | Record<string, unknown>): Promise<QueryTuple<T>>;
    prepare(sql: string | PrepareOptions): Promise<PromisePreparedStatement>;
    unprepare(sql: string): this;
    clearPreparedStatementCache(): this;
    preparedStatementCacheStats(): PreparedStatementCacheStats;
    sessionStateSnapshot(): SessionStateSnapshot;
    resetConnection(options?: ResetConnectionOptions): Promise<this>;
    beginTransaction(options?: object): Promise<this>;
    commit(options?: object): Promise<this>;
    rollback(options?: object): Promise<this>;
    changeUser(options?: ConnectionOptions): Promise<this>;
    ping(options?: object): Promise<this>;
    statistics(options?: object): Promise<unknown>;
    end(options?: object): Promise<void>;
    destroy(): void;
    release(): void;
    escape(value: unknown): string;
    escapeId(value: unknown): string;
    format(sql: string, values?: unknown[]): string;
    stream<T = Row>(sql: string | QueryOptions, values?: unknown[], options?: StreamOptions): AsyncRowStream<T>;
    iterate<T = Row>(sql: string | QueryOptions, values?: unknown[], options?: StreamOptions): AsyncRowStream<T>;
    withTransaction<T>(work: (connection: PromiseConnection, attempt: number) => T | Promise<T>, options?: TransactionOptions): Promise<T>;
    promise(): this;
  }

  interface PromisePool {
    readonly pool: Pool;
    readonly config: PoolOptions;
    getConnection(): Promise<PromiseConnection>;
    warmup(count?: number): Promise<PoolWarmupResult>;
    query<T = QueryResult>(sql: string | QueryOptions, values?: unknown[] | Record<string, unknown>): Promise<QueryTuple<T>>;
    execute<T = QueryResult>(sql: string | ExecuteOptions, values?: unknown[] | Record<string, unknown>): Promise<QueryTuple<T>>;
    end(): Promise<void>;
    withTransaction<T>(work: (connection: PromiseConnection, attempt: number) => T | Promise<T>, options?: TransactionOptions): Promise<T>;
    healthCheck(): Promise<HealthCheckResult>;
    stats(): PoolStats;
    circuitBreakerStats(): CircuitBreakerStats;
    admissionStats(): AdmissionStats;
    escape(value: unknown): string;
    escapeId(value: unknown): string;
    stream<T = Row>(sql: string | QueryOptions, values?: unknown[], options?: StreamOptions): AsyncRowStream<T>;
    iterate<T = Row>(sql: string | QueryOptions, values?: unknown[], options?: StreamOptions): AsyncRowStream<T>;
    promise(): this;
  }

  function createConnection(config: string | ConnectionOptions): Connection;
  function createPool(config: string | PoolOptions): Pool;
  function createPoolCluster(config?: PoolClusterOptions): PoolCluster;
  function createQuery(sql: string, values?: unknown[] | Record<string, unknown>, callback?: Function): Query;
  function escape(value: unknown, stringifyObjects?: boolean, timeZone?: string): string;
  function escapeId(value: unknown, forbidQualified?: boolean): string;
  function format(sql: string, values?: unknown[], stringifyObjects?: boolean, timeZone?: string): string;
  function raw(sql: string): object;

  const param: PreparedParameterFactory;
  const Types: Record<string, number>;
  const PromiseConnection: Function;
  const PromisePool: Function;
}

export = mysql;
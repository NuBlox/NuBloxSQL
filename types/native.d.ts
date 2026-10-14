/** Redis RESP2 standalone native connection; not the SQL client. */
export interface RedisNativeConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /** Redis logical DB. Unsupported by some Redis deployments. */
  database?: number;
  /** Required for non-loopback connections; certificates are always verified. */
  tls?: boolean | {
    ca?: string | Buffer | readonly (string | Buffer)[];
    cert?: string | Buffer;
    key?: string | Buffer;
    pfx?: string | Buffer;
    passphrase?: string;
    ciphers?: string;
    servername?: string;
    minVersion?: string;
    maxVersion?: string;
    rejectUnauthorized?: true;
  };
  connectTimeout?: number;
  commandTimeout?: number;
  maxResponseBytes?: number;
  maxCommandBytes?: number;
}
export type RedisNativeArgument = string | Buffer | number | bigint;
export type RedisNativeReply =
  | string | number | bigint | Buffer | null
  | readonly RedisNativeReply[];
export interface RedisNativeConnection {
  readonly connected: boolean;
  readonly ended: boolean;
  connect(): Promise<this>;
  command(name: string, ...args: RedisNativeArgument[]): Promise<RedisNativeReply>;
  ping(message?: RedisNativeArgument): Promise<RedisNativeReply>;
  /** Returns a binary-safe Buffer, or null if the key does not exist. */
  get(key: RedisNativeArgument): Promise<Buffer | null>;
  set(key: RedisNativeArgument, value: RedisNativeArgument): Promise<string>;
  del(...keys: RedisNativeArgument[]): Promise<number>;
  end(): Promise<void>;
  close(): Promise<void>;
}
export function createNativeConnection(technology: 'redis', options?: RedisNativeConfig): RedisNativeConnection;
export function createNativeConnection(config: RedisNativeConfig & {technology:'redis'}): RedisNativeConnection;

/** Initial MongoDB direct-host document adapter, independent of the SQL API.
 * Requires the separately installed `mongodb` official Node.js package.
 */
export interface MongoNativeConfig {
  /** Direct host (mutually exclusive with seeds and srvHost). */
  host?: string;
  port?: number;
  /** Replica-set discovery seed list (max 16 entries), requires replicaSet. */
  seeds?: readonly Readonly<{host: string; port?: number}>[];
  /** DNS SRV hostname. Excludes host, port and seeds; verified TLS is mandatory. */
  srvHost?: string;
  /** Replica-set name, checked by the MongoDB driver during discovery. */
  replicaSet?: string;
  database: string;
  username?: string;
  password?: string;
  authSource?: string;
  /** Required on non-loopback hosts. Certificate validation cannot be disabled. */
  tls?: boolean;
  tlsCAFile?: string;
  connectTimeout?: number;
  commandTimeout?: number;
  maxPoolSize?: number;
  maxResults?: number;
}
export interface MongoNativeConnection {
  readonly connected: boolean;
  readonly ended: boolean;
  connect(): Promise<this>;
  /** Live server round-trip (not the cached connected flag); sanitized errors. */
  ping(): Promise<boolean>;
  findOne<T = Record<string, unknown>>(collection: string, filter?: Readonly<Record<string, unknown>>): Promise<T | null>;
  find<T = Record<string, unknown>>(collection: string, filter?: Readonly<Record<string, unknown>>,
    options?: {readonly limit?: number;readonly batchSize?: number}): Promise<T[]>;
  /** Bounded async document iteration; releases cursor on exhaustion, error or early exit. */
  iterate<T = Record<string, unknown>>(collection: string, filter?: Readonly<Record<string, unknown>>,
    options?: {readonly limit?: number;readonly batchSize?: number}): AsyncIterableIterator<T>;
  insertOne(collection: string, document: Record<string, unknown>): Promise<{acknowledged: boolean;insertedId: unknown}>;
  updateOne(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{matchedCount: number;modifiedCount: number}>;
  deleteOne(collection: string, filter: Record<string, unknown>): Promise<{deletedCount: number}>;
  countDocuments(collection: string, filter?: Readonly<Record<string, unknown>>): Promise<number>;
  close(): Promise<void>;
  end(): Promise<void>;
}
export function createNativeConnection(technology: 'mongodb', options: MongoNativeConfig): MongoNativeConnection;
export function createNativeConnection(config: MongoNativeConfig & {technology:'mongodb'}): MongoNativeConnection;

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

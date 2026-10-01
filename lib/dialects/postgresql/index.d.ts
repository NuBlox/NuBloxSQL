/// <reference types="node" />

import { EventEmitter } from 'node:events';

export interface PostgreSqlDialectIdentity { readonly family: 'postgresql'; readonly name: 'PostgreSQL'; readonly serverVersion?: string; readonly protocolVersion?: string; }
export type PostgreSqlCapabilityMap = Readonly<Record<string, boolean>>;
export interface PostgreSqlDialectServices { quoteIdentifier(identifier: string): string; placeholder(index: number, name?: string): string; }
export interface PostgreSqlDialectDescriptor { readonly identity: PostgreSqlDialectIdentity; readonly capabilities: PostgreSqlCapabilityMap; readonly services: PostgreSqlDialectServices; supports(capability: string): boolean; }
export interface PostgreSqlObjectName { catalog?: string; schema?: string; name: string; }
export type PostgreSqlTransactionStatus = 'I' | 'T' | 'E';
export interface PostgreSqlAuthenticationMessage { type: 'authentication'; code: number; salt?: Buffer; mechanisms?: string[]; data?: Buffer; }
export interface PostgreSqlParameterStatusMessage { type: 'parameterStatus'; name: string; value: string; }
export interface PostgreSqlBackendKeyDataMessage { type: 'backendKeyData'; processId: number; secretKey: Buffer; }
export interface PostgreSqlReadyForQueryMessage { type: 'readyForQuery'; transactionStatus: PostgreSqlTransactionStatus; }
export interface PostgreSqlFieldResponseMessage { type: 'errorResponse' | 'noticeResponse'; fields: Record<string, string>; }
export interface PostgreSqlFieldDescription { name: string; tableOid: number; columnId: number; dataTypeOid: number; dataTypeSize: number; typeModifier: number; format: number; }
export interface PostgreSqlRowDescriptionMessage { type: 'rowDescription'; fields: PostgreSqlFieldDescription[]; }
export interface PostgreSqlDataRowMessage { type: 'dataRow'; values: Array<Buffer | null>; }
export interface PostgreSqlCommandCompleteMessage { type: 'commandComplete'; tag: string; }
export interface PostgreSqlEmptyQueryResponseMessage { type: 'emptyQueryResponse'; }
export interface PostgreSqlParseCompleteMessage { type: 'parseComplete'; }
export interface PostgreSqlBindCompleteMessage { type: 'bindComplete'; }
export interface PostgreSqlCloseCompleteMessage { type: 'closeComplete'; }
export interface PostgreSqlNoDataMessage { type: 'noData'; }
export interface PostgreSqlPortalSuspendedMessage { type: 'portalSuspended'; }
export interface PostgreSqlParameterDescriptionMessage { type: 'parameterDescription'; parameterTypeOids: number[]; }
export interface PostgreSqlCopyResponseMessage { type: 'copyInResponse' | 'copyOutResponse' | 'copyBothResponse'; format: 0 | 1; columnFormats: Array<0 | 1>; }
export interface PostgreSqlCopyDataMessage { type: 'copyData'; data: Buffer; }
export interface PostgreSqlCopyDoneMessage { type: 'copyDone'; }
export interface PostgreSqlUnknownBackendMessage { type: 'unknown'; messageType: string; payload: Buffer; }
export type PostgreSqlBackendMessage = PostgreSqlAuthenticationMessage | PostgreSqlParameterStatusMessage | PostgreSqlBackendKeyDataMessage | PostgreSqlReadyForQueryMessage | PostgreSqlFieldResponseMessage | PostgreSqlRowDescriptionMessage | PostgreSqlDataRowMessage | PostgreSqlCommandCompleteMessage | PostgreSqlEmptyQueryResponseMessage | PostgreSqlParseCompleteMessage | PostgreSqlBindCompleteMessage | PostgreSqlCloseCompleteMessage | PostgreSqlNoDataMessage | PostgreSqlPortalSuspendedMessage | PostgreSqlParameterDescriptionMessage | PostgreSqlCopyResponseMessage | PostgreSqlCopyDataMessage | PostgreSqlCopyDoneMessage | PostgreSqlUnknownBackendMessage;
export interface PostgreSqlBackendMessageParserOptions { maxMessageSize?: number; }
export interface PostgreSqlBackendMessageParser { push(chunk: Buffer | Uint8Array): PostgreSqlBackendMessage[]; reset(): void; }
export interface PostgreSqlBackendMessageParserConstructor { new(options?: PostgreSqlBackendMessageParserOptions): PostgreSqlBackendMessageParser; }
export type PostgreSqlFormatCode = 0 | 1;
export type PostgreSqlBindParameter = string | Buffer | Uint8Array | null | undefined;
export interface PostgreSqlBindOptions { portal?: string; statement?: string; parameterFormats?: PostgreSqlFormatCode[]; parameters?: PostgreSqlBindParameter[]; resultFormats?: PostgreSqlFormatCode[]; }
export interface PostgreSqlProtocol { readonly constants: { readonly PROTOCOL_VERSION_3_0: number; readonly PROTOCOL_VERSION_3_2: number; readonly SSL_REQUEST_CODE: number; readonly CANCEL_REQUEST_CODE: number; readonly AUTHENTICATION: Readonly<Record<string, number>>; readonly BACKEND_MESSAGE_TYPES: Readonly<Record<string, string>>; }; encodeStartupMessage(parameters: Record<string, string | number | boolean | null | undefined> & { user: string }, protocolVersion?: number): Buffer; encodeSSLRequest(): Buffer; encodeCancelRequest(processId: number, secretKey: Buffer | Uint8Array): Buffer; encodePasswordMessage(password: string): Buffer; encodeSaslInitialResponse(mechanism: string, response: string): Buffer; encodeSaslResponse(response: string): Buffer; encodeQuery(sql: string): Buffer; encodeParse(statement: string, sql: string, parameterTypeOids?: number[]): Buffer; encodeBind(options?: PostgreSqlBindOptions): Buffer; encodeDescribe(target: 'S' | 'P', name?: string): Buffer; encodeExecute(portal?: string, maxRows?: number): Buffer; encodeClose(target: 'S' | 'P', name?: string): Buffer; encodeSync(): Buffer; encodeCopyData(data: string | Buffer | Uint8Array): Buffer; encodeCopyDone(): Buffer; encodeCopyFail(message?: string): Buffer; encodeTerminate(): Buffer; decodeBackendMessage(messageType: string, payload: Buffer): PostgreSqlBackendMessage; BackendMessageParser: PostgreSqlBackendMessageParserConstructor; }

export interface PostgreSqlSslOptions { mode?: 'prefer' | 'require'; rejectUnauthorized?: boolean; ca?: string | Buffer | Array<string | Buffer>; cert?: string | Buffer; key?: string | Buffer; servername?: string; minVersion?: string; maxVersion?: string; }
export interface PostgreSqlConnectionOptions { host?: string; port?: number; user: string; password?: string; database?: string; applicationName?: string; parameters?: Record<string, string | number | boolean | null | undefined>; ssl?: boolean | 'disable' | 'prefer' | 'require' | PostgreSqlSslOptions; connectTimeout?: number; cancelTimeout?: number; cancelGraceTimeout?: number; maxMessageSize?: number; maxRows?: number; maxResultBytes?: number; maxRowBytes?: number; maxCopyBufferBytes?: number; protocolVersion?: number; signal?: AbortSignal; }
export interface PostgreSqlQueryOptions { timeout?: number; signal?: AbortSignal; maxRows?: number; maxResultBytes?: number; maxRowBytes?: number; }
export interface PostgreSqlCancelOptions { reason?: Error; }
export interface PostgreSqlPrepareOptions extends PostgreSqlQueryOptions { name?: string; parameterTypeOids?: number[]; }
export interface PostgreSqlCursorOptions extends PostgreSqlQueryOptions { name?: string; batchSize?: number; }
export type PostgreSqlCopyChunk = string | Buffer | Uint8Array;
export type PostgreSqlCopySource = PostgreSqlCopyChunk | Iterable<PostgreSqlCopyChunk> | AsyncIterable<PostgreSqlCopyChunk>;
export type PostgreSqlCopySink = ((chunk: Buffer) => void | Promise<void>) | NodeJS.WritableStream;
export interface PostgreSqlCopyOptions extends PostgreSqlQueryOptions { maxBytes?: number; sink?: PostgreSqlCopySink; acquire?: PostgreSqlPoolAcquireOptions; }
export interface PostgreSqlCopyResult { readonly direction: 'from' | 'to'; readonly format: 'text' | 'binary'; readonly columnFormats: readonly ('text' | 'binary')[]; readonly bytes: number; readonly command: string; readonly rowCount: number | null; readonly data?: Buffer; }
export type PostgreSqlIsolationLevel = 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'serializable';
export interface PostgreSqlTransactionOptions extends PostgreSqlQueryOptions { isolationLevel?: PostgreSqlIsolationLevel; readOnly?: boolean; deferrable?: boolean; acquire?: PostgreSqlPoolAcquireOptions; }
export interface PostgreSqlPoolAcquireOptions { timeout?: number; signal?: AbortSignal; }
export interface PostgreSqlPoolQueryOptions extends PostgreSqlQueryOptions { acquire?: PostgreSqlPoolAcquireOptions; }
export interface PostgreSqlPoolConfig extends PostgreSqlConnectionOptions { connectionLimit?: number; maxIdle?: number; idleTimeout?: number; acquireTimeout?: number; queueLimit?: number; resetOnRelease?: boolean; }
export type PostgreSqlParameter = string | number | bigint | boolean | Date | Buffer | Uint8Array | Record<string, unknown> | unknown[] | null | undefined;
export interface PostgreSqlQueryResult<Row = Record<string, unknown>> { rows: Row[]; fields: PostgreSqlFieldDescription[]; command: string; rowCount: number | null; }
export interface PostgreSqlCursorBatch<Row = Record<string, unknown>> { rows: Row[]; fields: PostgreSqlFieldDescription[]; done: boolean; command: string; rowCount: number | null; }
export class PostgreSqlError extends Error { code?: string; severity?: string; fields: Record<string, string>; }
export class PostgreSqlCancellationError extends Error { readonly code: string; readonly cause?: unknown; }
export class PostgreSqlResultLimitError extends RangeError { readonly code: string; readonly limit: number; readonly observed: number; }
export class PortalCursor<Row = Record<string, unknown>> implements AsyncIterable<Row> {
  readonly connection: Connection;
  readonly statement: PreparedStatement;
  readonly name: string;
  readonly batchSize: number;
  readonly parameters: PostgreSqlParameter[];
  fields: PostgreSqlFieldDescription[];
  closed: boolean;
  done: boolean;
  fetch(options?: PostgreSqlQueryOptions): Promise<PostgreSqlCursorBatch<Row>>;
  close(options?: PostgreSqlQueryOptions): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<Row>;
}
export class PreparedStatement {
  readonly connection: Connection;
  readonly name: string;
  readonly sql: string;
  readonly parameterTypeOids: number[];
  readonly fields: PostgreSqlFieldDescription[];
  closed: boolean;
  execute<Row = Record<string, unknown>>(parameters?: PostgreSqlParameter[], options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult<Row>>;
  openCursor<Row = Record<string, unknown>>(parameters?: PostgreSqlParameter[], options?: PostgreSqlCursorOptions): PortalCursor<Row>;
  close(options?: PostgreSqlQueryOptions): Promise<void>;
}
export class Connection extends EventEmitter {
  readonly config: PostgreSqlConnectionOptions;
  readonly parameters: Record<string, string>;
  readonly backendKeyData: PostgreSqlBackendKeyDataMessage | null;
  readonly transactionStatus: PostgreSqlTransactionStatus | null;
  readonly connected: boolean;
  readonly ended: boolean;
  readonly cancelGraceTimeout: number;
  readonly maxRows: number;
  readonly maxResultBytes: number;
  readonly maxRowBytes: number;
  readonly maxCopyBufferBytes: number;
  constructor(config: PostgreSqlConnectionOptions);
  connect(): Promise<this>;
  query<Row = Record<string, unknown>>(sql: string, options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult<Row>>;
  prepare(sql: string, options?: PostgreSqlPrepareOptions): Promise<PreparedStatement>;
  execute<Row = Record<string, unknown>>(sql: string, parameters?: PostgreSqlParameter[], options?: PostgreSqlPrepareOptions): Promise<PostgreSqlQueryResult<Row>>;
  copyFrom(sql: string, source: PostgreSqlCopySource, options?: PostgreSqlCopyOptions): Promise<PostgreSqlCopyResult>;
  copyTo(sql: string, options?: PostgreSqlCopyOptions): Promise<PostgreSqlCopyResult>;
  cancel(options?: PostgreSqlCancelOptions): Promise<void>;
  beginTransaction(options?: PostgreSqlTransactionOptions): Promise<PostgreSqlQueryResult>;
  commit(options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult>;
  rollback(options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult>;
  withTransaction<T>(fn: (connection: this) => T | Promise<T>, options?: PostgreSqlTransactionOptions): Promise<T>;
  savepoint(name: string, options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult>;
  rollbackToSavepoint(name: string, options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult>;
  releaseSavepoint(name: string, options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult>;
  resetSession(options?: PostgreSqlQueryOptions): Promise<this>;
  end(): Promise<void>;
  destroy(error?: Error): void;
}
export class Pool extends EventEmitter {
  readonly config: PostgreSqlPoolConfig;
  readonly connectionLimit: number;
  readonly maxIdle: number;
  readonly idleTimeout: number;
  readonly acquireTimeout: number;
  readonly queueLimit: number;
  readonly resetOnRelease: boolean;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly borrowedCount: number;
  readonly waitingCount: number;
  readonly resettingCount: number;
  constructor(config: PostgreSqlPoolConfig);
  getConnection(options?: PostgreSqlPoolAcquireOptions): Promise<Connection>;
  releaseConnection(connection: Connection): Promise<void>;
  query<Row = Record<string, unknown>>(sql: string, options?: PostgreSqlPoolQueryOptions): Promise<PostgreSqlQueryResult<Row>>;
  execute<Row = Record<string, unknown>>(sql: string, parameters?: PostgreSqlParameter[], options?: PostgreSqlPoolQueryOptions): Promise<PostgreSqlQueryResult<Row>>;
  copyFrom(sql: string, source: PostgreSqlCopySource, options?: PostgreSqlCopyOptions): Promise<PostgreSqlCopyResult>;
  copyTo(sql: string, options?: PostgreSqlCopyOptions): Promise<PostgreSqlCopyResult>;
  withTransaction<T>(fn: (connection: Connection) => T | Promise<T>, options?: PostgreSqlTransactionOptions): Promise<T>;
  end(): Promise<void>;
}

export const descriptor: PostgreSqlDialectDescriptor;
export const capabilities: PostgreSqlCapabilityMap;
export const services: PostgreSqlDialectServices;
export const protocol: PostgreSqlProtocol;
export const DEFAULT_RESULT_LIMITS: Readonly<{ maxRows: number; maxResultBytes: number; maxRowBytes: number }>;
export const DEFAULT_COPY_BUFFER_BYTES: number;
export function createObjectName(name: PostgreSqlObjectName): Readonly<PostgreSqlObjectName>;
export function createConnection(config: PostgreSqlConnectionOptions): Connection;
export function createPool(config: PostgreSqlPoolConfig): Pool;

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
export interface PostgreSqlUnknownBackendMessage { type: 'unknown'; messageType: string; payload: Buffer; }
export type PostgreSqlBackendMessage = PostgreSqlAuthenticationMessage | PostgreSqlParameterStatusMessage | PostgreSqlBackendKeyDataMessage | PostgreSqlReadyForQueryMessage | PostgreSqlFieldResponseMessage | PostgreSqlRowDescriptionMessage | PostgreSqlDataRowMessage | PostgreSqlCommandCompleteMessage | PostgreSqlEmptyQueryResponseMessage | PostgreSqlUnknownBackendMessage;
export interface PostgreSqlBackendMessageParserOptions { maxMessageSize?: number; }
export interface PostgreSqlBackendMessageParser { push(chunk: Buffer | Uint8Array): PostgreSqlBackendMessage[]; reset(): void; }
export interface PostgreSqlBackendMessageParserConstructor { new(options?: PostgreSqlBackendMessageParserOptions): PostgreSqlBackendMessageParser; }
export interface PostgreSqlProtocol { readonly constants: { readonly PROTOCOL_VERSION_3_0: number; readonly PROTOCOL_VERSION_3_2: number; readonly SSL_REQUEST_CODE: number; readonly CANCEL_REQUEST_CODE: number; readonly AUTHENTICATION: Readonly<Record<string, number>>; readonly BACKEND_MESSAGE_TYPES: Readonly<Record<string, string>>; }; encodeStartupMessage(parameters: Record<string, string | number | boolean | null | undefined> & { user: string }, protocolVersion?: number): Buffer; encodeSSLRequest(): Buffer; encodePasswordMessage(password: string): Buffer; encodeSaslInitialResponse(mechanism: string, response: string): Buffer; encodeSaslResponse(response: string): Buffer; encodeQuery(sql: string): Buffer; encodeTerminate(): Buffer; decodeBackendMessage(messageType: string, payload: Buffer): PostgreSqlBackendMessage; BackendMessageParser: PostgreSqlBackendMessageParserConstructor; }

export interface PostgreSqlSslOptions { mode?: 'prefer' | 'require'; rejectUnauthorized?: boolean; ca?: string | Buffer | Array<string | Buffer>; cert?: string | Buffer; key?: string | Buffer; servername?: string; minVersion?: string; maxVersion?: string; }
export interface PostgreSqlConnectionOptions { host?: string; port?: number; user: string; password?: string; database?: string; applicationName?: string; parameters?: Record<string, string | number | boolean | null | undefined>; ssl?: boolean | 'disable' | 'prefer' | 'require' | PostgreSqlSslOptions; connectTimeout?: number; maxMessageSize?: number; protocolVersion?: number; signal?: AbortSignal; }
export interface PostgreSqlQueryOptions { timeout?: number; signal?: AbortSignal; }
export interface PostgreSqlQueryResult<Row = Record<string, unknown>> { rows: Row[]; fields: PostgreSqlFieldDescription[]; command: string; rowCount: number | null; }
export class PostgreSqlError extends Error { code?: string; severity?: string; fields: Record<string, string>; }
export class Connection extends EventEmitter { readonly config: PostgreSqlConnectionOptions; readonly parameters: Record<string, string>; readonly backendKeyData: PostgreSqlBackendKeyDataMessage | null; readonly transactionStatus: PostgreSqlTransactionStatus | null; readonly connected: boolean; readonly ended: boolean; constructor(config: PostgreSqlConnectionOptions); connect(): Promise<this>; query<Row = Record<string, unknown>>(sql: string, options?: PostgreSqlQueryOptions): Promise<PostgreSqlQueryResult<Row>>; end(): Promise<void>; destroy(error?: Error): void; }

export const descriptor: PostgreSqlDialectDescriptor;
export const capabilities: PostgreSqlCapabilityMap;
export const services: PostgreSqlDialectServices;
export const protocol: PostgreSqlProtocol;
export function createObjectName(name: PostgreSqlObjectName): Readonly<PostgreSqlObjectName>;
export function createConnection(config: PostgreSqlConnectionOptions): Connection;

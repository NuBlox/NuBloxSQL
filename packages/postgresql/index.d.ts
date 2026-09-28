/// <reference types="node" />

export interface PostgreSqlDialectIdentity {
  readonly family: 'postgresql';
  readonly name: 'PostgreSQL';
  readonly serverVersion?: string;
  readonly protocolVersion?: string;
}

export type PostgreSqlCapabilityMap = Readonly<Record<string, boolean>>;

export interface PostgreSqlDialectServices {
  quoteIdentifier(identifier: string): string;
  placeholder(index: number, name?: string): string;
}

export interface PostgreSqlDialectDescriptor {
  readonly identity: PostgreSqlDialectIdentity;
  readonly capabilities: PostgreSqlCapabilityMap;
  readonly services: PostgreSqlDialectServices;
  supports(capability: string): boolean;
}

export interface PostgreSqlObjectName {
  catalog?: string;
  schema?: string;
  name: string;
}

export type PostgreSqlTransactionStatus = 'I' | 'T' | 'E';

export interface PostgreSqlAuthenticationMessage {
  type: 'authentication';
  code: number;
  salt?: Buffer;
  mechanisms?: string[];
  data?: Buffer;
}

export interface PostgreSqlParameterStatusMessage {
  type: 'parameterStatus';
  name: string;
  value: string;
}

export interface PostgreSqlBackendKeyDataMessage {
  type: 'backendKeyData';
  processId: number;
  secretKey: Buffer;
}

export interface PostgreSqlReadyForQueryMessage {
  type: 'readyForQuery';
  transactionStatus: PostgreSqlTransactionStatus;
}

export interface PostgreSqlFieldResponseMessage {
  type: 'errorResponse' | 'noticeResponse';
  fields: Record<string, string>;
}

export interface PostgreSqlUnknownBackendMessage {
  type: 'unknown';
  messageType: string;
  payload: Buffer;
}

export type PostgreSqlBackendMessage = PostgreSqlAuthenticationMessage | PostgreSqlParameterStatusMessage | PostgreSqlBackendKeyDataMessage | PostgreSqlReadyForQueryMessage | PostgreSqlFieldResponseMessage | PostgreSqlUnknownBackendMessage;

export interface PostgreSqlBackendMessageParserOptions {
  maxMessageSize?: number;
}

export interface PostgreSqlBackendMessageParser {
  push(chunk: Buffer | Uint8Array): PostgreSqlBackendMessage[];
  reset(): void;
}

export interface PostgreSqlBackendMessageParserConstructor {
  new(options?: PostgreSqlBackendMessageParserOptions): PostgreSqlBackendMessageParser;
}

export interface PostgreSqlProtocol {
  readonly constants: {
    readonly PROTOCOL_VERSION_3_0: number;
    readonly PROTOCOL_VERSION_3_2: number;
    readonly SSL_REQUEST_CODE: number;
    readonly CANCEL_REQUEST_CODE: number;
    readonly AUTHENTICATION: Readonly<Record<string, number>>;
    readonly BACKEND_MESSAGE_TYPES: Readonly<Record<string, string>>;
  };
  encodeStartupMessage(parameters: Record<string, string | number | boolean | null | undefined> & { user: string }, protocolVersion?: number): Buffer;
  encodeSSLRequest(): Buffer;
  decodeBackendMessage(messageType: string, payload: Buffer): PostgreSqlBackendMessage;
  BackendMessageParser: PostgreSqlBackendMessageParserConstructor;
}

export const descriptor: PostgreSqlDialectDescriptor;
export const capabilities: PostgreSqlCapabilityMap;
export const services: PostgreSqlDialectServices;
export const protocol: PostgreSqlProtocol;
export function createObjectName(name: PostgreSqlObjectName): Readonly<PostgreSqlObjectName>;

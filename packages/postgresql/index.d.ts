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

export const descriptor: PostgreSqlDialectDescriptor;
export const capabilities: PostgreSqlCapabilityMap;
export const services: PostgreSqlDialectServices;
export function createObjectName(name: PostgreSqlObjectName): Readonly<PostgreSqlObjectName>;

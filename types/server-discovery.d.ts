import type * as root from '../index';
import type { DatabaseBootstrapPlan } from './database-bootstrap';

export type DatabaseServerPrerequisiteStatus = 'ready' | 'attention' | 'blocked';

export interface DatabaseServerIdentity {
  readonly product: 'PostgreSQL' | 'MySQL' | 'SQLite' | 'SQL Server';
  readonly version: string | null;
  readonly edition: string | null;
  readonly serverName: string | null;
  readonly currentDatabase: string | null;
  readonly currentUser: string | null;
}

export interface DatabaseServerDatabase {
  readonly name: string | null;
  readonly accessible: boolean | null;
  readonly kind: 'database' | 'template' | 'attached-database';
  readonly native: Readonly<Record<string, unknown>>;
}

export interface DatabaseServerDiscovery {
  readonly schemaVersion: 1;
  readonly dialect: root.Dialect;
  readonly identity: Readonly<DatabaseServerIdentity>;
  readonly databases: readonly DatabaseServerDatabase[];
  readonly summary: Readonly<{
    databases: number;
    accessible: number;
    inaccessible: number;
    unknownAccessibility: number;
  }>;
  readonly native: Readonly<{
    identity: Readonly<Record<string, unknown>>;
    databases: readonly Readonly<Record<string, unknown>>[];
  }>;
}

export interface DatabaseBootstrapPrerequisiteCheck {
  readonly id: string;
  readonly status: DatabaseServerPrerequisiteStatus;
  readonly message: string;
}

export interface DatabaseBootstrapPrerequisiteReport {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly targetDialect: root.Dialect;
  readonly targetDatabase: string | null;
  readonly status: DatabaseServerPrerequisiteStatus;
  readonly discovery: DatabaseServerDiscovery | null;
  readonly checks: readonly DatabaseBootstrapPrerequisiteCheck[];
}

export interface DatabaseServerDiscoveryOptions {
  readonly operation?: Readonly<Record<string, unknown>>;
}

export const DATABASE_SERVER_DISCOVERY_SCHEMA_VERSION: 1;
export const DATABASE_BOOTSTRAP_PREREQUISITE_SCHEMA_VERSION: 1;
export const DATABASE_BOOTSTRAP_PREREQUISITE_STATUSES: readonly DatabaseServerPrerequisiteStatus[];

export function discoverDatabaseServer(
  client: root.Client,
  options?: DatabaseServerDiscoveryOptions
): Promise<DatabaseServerDiscovery>;

export function assessDatabaseBootstrapPrerequisites(
  client: root.Client,
  plan: DatabaseBootstrapPlan,
  options?: DatabaseServerDiscoveryOptions & { readonly discovery?: DatabaseServerDiscovery }
): Promise<DatabaseBootstrapPrerequisiteReport>;

declare module './index' {
  interface Client {
    discoverServer(options?: DatabaseServerDiscoveryOptions): Promise<DatabaseServerDiscovery>;
    assessBootstrapPrerequisites(
      plan: DatabaseBootstrapPlan,
      options?: DatabaseServerDiscoveryOptions & { readonly discovery?: DatabaseServerDiscovery }
    ): Promise<DatabaseBootstrapPrerequisiteReport>;
  }
}

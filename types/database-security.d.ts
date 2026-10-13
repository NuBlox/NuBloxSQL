import type * as root from '../index';

/**
 * A partial security-inventory observation. This is never an effective-access
 * decision and must not authorize database operations.
 */
export type DatabaseSecurityVisibility =
  | 'permission-scoped' | 'current-account-only' | 'not-applicable';
export type DatabaseSecurityScope =
  | 'cluster' | 'current-account' | 'current-database' | 'embedded-runtime';

export interface DatabaseSecurityPrincipal {
  readonly name: string;
  readonly kind: 'role' | 'account' | 'database-principal';
  readonly canLogin: boolean | null;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DatabaseSecurityMembership {
  readonly member: string;
  readonly role: string;
  readonly grantor: string | null;
  readonly adminOption: boolean | null;
}

export interface DatabaseSecurityGrant {
  readonly kind: 'native-statement' | 'explicit-permission';
  readonly principal: string;
  /** MySQL SHOW GRANTS text only; it is not a parsed or effective privilege set. */
  readonly statement?: string;
  /** SQL Server explicit permission metadata only. */
  readonly state?: 'GRANT' | 'GRANT_WITH_GRANT_OPTION' | 'DENY' | 'REVOKE';
  readonly permission?: string;
  readonly class?: string;
  readonly majorId?: number | null;
  readonly minorId?: number | null;
}

export interface DatabaseSecurityDiscovery {
  readonly schemaVersion: 1;
  readonly dialect: root.Dialect;
  readonly scope: DatabaseSecurityScope;
  readonly visibility: DatabaseSecurityVisibility;
  /** Always false: a privilege inventory/effective permissions cannot be inferred. */
  readonly complete: false;
  readonly limitation: string;
  readonly principals: readonly DatabaseSecurityPrincipal[];
  readonly memberships: readonly DatabaseSecurityMembership[];
  readonly grants: readonly DatabaseSecurityGrant[];
  readonly summary: Readonly<{
    principals: number;
    memberships: number;
    grants: number;
    truncated: Readonly<{ principals: boolean; memberships: boolean; grants: boolean }>;
  }>;
}

export interface DatabaseSecurityDiscoveryOptions {
  /** Maximum rows per category: 1..1000, default 1000. */
  readonly maxRows?: number;
  /** Existing NuBloxSQL operation controls and deadlines. */
  readonly operation?: Readonly<Record<string, unknown>>;
}

export const DATABASE_SECURITY_DISCOVERY_SCHEMA_VERSION: 1;
export function discoverDatabaseSecurity(
  client: root.Client, options?: DatabaseSecurityDiscoveryOptions
): Promise<DatabaseSecurityDiscovery>;

declare module './index' {
  interface Client {
    discoverSecurity(options?: DatabaseSecurityDiscoveryOptions): Promise<DatabaseSecurityDiscovery>;
  }
}

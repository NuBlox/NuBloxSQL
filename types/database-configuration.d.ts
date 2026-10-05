import type * as root from '../index';

export type DatabaseConfigurationApplyMode =
  | 'immediate' | 'reload' | 'restart' | 'new-session' | 'immutable' | 'unknown';

export type DatabaseConfigurationScope =
  | 'server' | 'database' | 'session' | 'connection' | 'unknown';

export interface DatabaseConfigurationSetting {
  readonly name: string;
  readonly value: unknown;
  readonly scope: DatabaseConfigurationScope;
  readonly apply: DatabaseConfigurationApplyMode;
  readonly mutable: boolean | null;
  readonly restartRequired: boolean | null;
  readonly source: string | null;
  readonly description: string | null;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface DatabaseConfigurationDiscovery {
  readonly schemaVersion: 1;
  readonly dialect: root.Dialect;
  readonly settings: readonly DatabaseConfigurationSetting[];
  readonly summary: Readonly<{
    settings: number;
    mutable: number;
    immutable: number;
    restartRequired: number;
    unknownMutability: number;
  }>;
}

export interface DatabaseConfigurationDiscoveryOptions {
  readonly operation?: Readonly<Record<string, unknown>>;
}

export const DATABASE_CONFIGURATION_DISCOVERY_SCHEMA_VERSION: 1;
export const DATABASE_CONFIGURATION_APPLY_MODES: readonly DatabaseConfigurationApplyMode[];
export const DATABASE_CONFIGURATION_SCOPES: readonly DatabaseConfigurationScope[];

export function discoverDatabaseConfiguration(
  client: root.Client,
  options?: DatabaseConfigurationDiscoveryOptions
): Promise<DatabaseConfigurationDiscovery>;

export function findDatabaseConfiguration(
  report: DatabaseConfigurationDiscovery,
  name: string
): DatabaseConfigurationSetting | null;

declare module './index' {
  interface Client {
    discoverConfiguration(
      options?: DatabaseConfigurationDiscoveryOptions
    ): Promise<DatabaseConfigurationDiscovery>;
  }
}

import type * as root from '../index';

/** Read-only, permission-scoped observation of engine-native scheduled jobs. */
export interface NativeDatabaseJob {
  readonly kind: 'mysql-event' | 'sqlserver-agent-job';
  readonly name: string;
  readonly enabled: boolean;
  /** SQL Server Agent only; no step or ownership metadata is included. */
  readonly id?: string;
  /** MySQL Event Scheduler only. */
  readonly schema?: string;
  readonly status?: string;
  readonly scheduleKind?: 'ONE TIME' | 'RECURRING';
  readonly timeZone?: string;
}

export interface NativeDatabaseJobDiscovery {
  readonly schemaVersion: 1;
  readonly dialect: root.Dialect;
  readonly system: 'mysql-event-scheduler' | 'sqlserver-agent' | null;
  readonly scope: 'server-visible-events' | 'server-visible-jobs' | 'extension-or-external' | 'embedded-runtime';
  readonly visibility: 'permission-scoped' | 'not-inspected' | 'not-applicable';
  /** Never a claim of comprehensive engine/host inventory. */
  readonly complete: false;
  readonly limitation: string;
  readonly jobs: readonly NativeDatabaseJob[];
  readonly summary: Readonly<{ count: number; truncated: boolean }>;
}

export interface NativeDatabaseJobDiscoveryOptions {
  /** 1..1000 entries; defaults to 100. One extra row is fetched to detect truncation. */
  readonly maxRows?: number;
  readonly operation?: Readonly<Record<string, unknown>>;
}
export const NATIVE_DATABASE_JOB_DISCOVERY_SCHEMA_VERSION: 1;
export function discoverNativeDatabaseJobs(
  client: root.Client, options?: NativeDatabaseJobDiscoveryOptions
): Promise<NativeDatabaseJobDiscovery>;

declare module './index' {
  interface Client {
    discoverNativeJobs(options?: NativeDatabaseJobDiscoveryOptions): Promise<NativeDatabaseJobDiscovery>;
  }
}

import type * as root from '../index';

/**
 * MySQL EVENTS stores event-local schedule timestamps. It does NOT expose
 * per-event execution success/failure or an independent execution history.
 */
export interface MySqlNativeJobOperational {
  readonly outcome: 'not-reported';
  /** Local event-time timestamp with no UTC offset; null if never executed. */
  readonly lastExecutedLocal: string | null;
  readonly schedule: Readonly<{
    executeAtLocal: string | null;
    startsLocal: string | null;
    endsLocal: string | null;
    intervalValue: string | null;
    intervalField: string | null;
  }>;
}

/**
 * SQL Server Agent job-level history; excludes step messages/command bodies.
 * Agent sysjobschedules can refresh as infrequently as every 20 minutes.
 */
export interface SqlServerNativeJobOperational {
  readonly scheduleCount: number;
  /** Local server scheduling timestamp without a UTC offset. */
  readonly nextRunLocal: string | null;
  readonly nextRunMayBeStale: true;
  readonly runningStateReliable: false;
  readonly lastRun: Readonly<{
    readonly outcome: 'failed' | 'succeeded' | 'retry' | 'canceled' | 'in-progress';
    readonly startedLocal: string;
    readonly durationSeconds: number;
  }> | null;
}

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
  /** Available when includeOperational=true; shape depends on job kind. */
  readonly operational?: MySqlNativeJobOperational | SqlServerNativeJobOperational;
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
  /**
   * Opt-in read-only schedule/last-execution metadata. MySQL cannot report
   * execution success, SQL Server history may not reflect running jobs.
   * Additional native metadata privileges may be required for SQL Server.
   */
  readonly includeOperational?: boolean;
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

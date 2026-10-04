import type * as root from '../index';
import type { MigrationPlan, MigrationStep } from './migration-planner';

export type MigrationExecutionStatus =
  | 'planned' | 'skipped' | 'running' | 'succeeded' | 'failed' | 'manual' | 'blocked';

export type MigrationApprovalMode = 'none' | 'risky' | 'all';
export type MigrationFailurePolicy = 'stop' | 'compensate';
export type MigrationTransactionMode = 'none' | 'single';

export interface MigrationCheckpoint {
  readonly schemaVersion: 1;
  readonly migrationPlanSchemaVersion: 1;
  readonly targetDialect: root.Dialect;
  readonly sourceSemanticHash: string | null;
  readonly targetSemanticHash: string | null;
  readonly completedStepIds: readonly string[];
  readonly failedStepId: string | null;
}

export interface MigrationAuditRecord {
  readonly stepId: string;
  readonly logicalKey: string;
  readonly safety: string;
  readonly execution: string;
  readonly sql: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: MigrationExecutionStatus;
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export interface MigrationRecoveryResult {
  readonly attempted: boolean;
  readonly succeeded: boolean | null;
  readonly steps: readonly Readonly<{
    stepId: string;
    status: 'succeeded' | 'failed';
    sql: string;
    error?: Readonly<{ name: string; message: string }>;
  }>[];
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export interface MigrationVerificationResult {
  readonly mode: 'none' | 'custom' | 'semantic-hash';
  readonly ok: boolean | null;
  readonly result?: unknown;
  readonly expectedSemanticHash?: string;
  readonly actualSemanticHash?: string;
}

export interface MigrationExecutionResult {
  readonly schemaVersion: 1;
  readonly status: 'blocked' | 'dry-run' | 'succeeded' | 'failed';
  readonly dryRun: boolean;
  readonly targetDialect: root.Dialect;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly checkpoint: MigrationCheckpoint;
  readonly audit: readonly MigrationAuditRecord[];
  readonly verification: MigrationVerificationResult;
  readonly recovery: MigrationRecoveryResult;
  readonly error: Readonly<{ name: string; message: string; stepId: string | null }> | null;
  readonly reason: string | null;
}

export interface MigrationExecutionOptions {
  dryRun?: boolean;
  approval?: MigrationApprovalMode;
  failurePolicy?: MigrationFailurePolicy;
  transactionMode?: MigrationTransactionMode;
  transactionOptions?: Readonly<Record<string, unknown>>;
  operation?: Readonly<Record<string, unknown>>;
  resumeFrom?: MigrationCheckpoint;
  expectedSnapshot?: Readonly<{ semanticHash: string }>;
  snapshotOptions?: Readonly<Record<string, unknown>>;
  clock?: () => number;
  approve?: (context: Readonly<{ client: root.Client; step: MigrationStep; context: unknown }>) => boolean | Promise<boolean>;
  manualHandler?: (context: Readonly<{ client: root.Client; step: MigrationStep; context: unknown }>) => unknown | Promise<unknown>;
  beforeStep?: (context: Readonly<{ client: root.Client; step: MigrationStep; context: unknown }>) => void | Promise<void>;
  afterStep?: (context: Readonly<{ client: root.Client; step: MigrationStep; result: unknown; context: unknown }>) => void | Promise<void>;
  verify?: (context: Readonly<{ client: root.Client; plan: MigrationPlan }>) => unknown | Promise<unknown>;
  onCheckpoint?: (checkpoint: MigrationCheckpoint, context: Readonly<{ client: root.Client; plan: MigrationPlan; step: MigrationStep; index: number }>) => void | Promise<void>;
  onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

export const MIGRATION_EXECUTION_SCHEMA_VERSION: 1;
export const MIGRATION_EXECUTION_STATUSES: readonly MigrationExecutionStatus[];
export const MIGRATION_APPROVAL_MODES: readonly MigrationApprovalMode[];
export const MIGRATION_FAILURE_POLICIES: readonly MigrationFailurePolicy[];
export const MIGRATION_TRANSACTION_MODES: readonly MigrationTransactionMode[];

export function executeMigration(client: root.Client, plan: MigrationPlan, options?: MigrationExecutionOptions): Promise<MigrationExecutionResult>;
export function resumeMigration(client: root.Client, plan: MigrationPlan, checkpoint: MigrationCheckpoint, options?: MigrationExecutionOptions): Promise<MigrationExecutionResult>;

declare module './index' {
  interface Client {
    executeMigration(plan: MigrationPlan, options?: MigrationExecutionOptions): Promise<MigrationExecutionResult>;
    resumeMigration(plan: MigrationPlan, checkpoint: MigrationCheckpoint, options?: MigrationExecutionOptions): Promise<MigrationExecutionResult>;
  }
}

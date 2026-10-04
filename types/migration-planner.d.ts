import type { SchemaDiff, SchemaChangeSafety } from './schema-diff';
import type * as root from '../index';

export type MigrationExecutionMode = 'automatic' | 'manual';
export type MigrationTransactionStrategy = 'transactional-preferred' | 'autocommit-boundary' | 'manual';

export interface MigrationRollback {
  readonly mode: 'compensating';
  readonly sql: string;
}

export interface MigrationStep {
  readonly id: string;
  readonly phase: number;
  readonly status: 'added' | 'removed' | 'modified';
  readonly safety: SchemaChangeSafety;
  readonly execution: MigrationExecutionMode;
  readonly targetDialect: root.Dialect;
  readonly logicalKey: string;
  readonly kind: string;
  readonly sql: string | null;
  readonly preconditions: readonly string[];
  readonly rollback: MigrationRollback | null;
  readonly notes: string | null;
}

export interface MigrationPlanSummary {
  readonly steps: number;
  readonly automatic: number;
  readonly manual: number;
  readonly safe: number;
  readonly dependencySensitive: number;
  readonly manualReview: number;
  readonly potentiallyLossy: number;
  readonly destructive: number;
}

export interface MigrationPlan {
  readonly schemaVersion: 1;
  readonly diffSchemaVersion: 1;
  readonly targetDialect: root.Dialect;
  readonly transactionStrategy: MigrationTransactionStrategy;
  readonly source: SchemaDiff['left'];
  readonly target: SchemaDiff['right'];
  readonly highestSafety: SchemaChangeSafety;
  readonly executable: boolean;
  readonly summary: MigrationPlanSummary;
  readonly steps: readonly MigrationStep[];
}

export interface MigrationPlanOptions {
  targetDialect?: root.DialectAlias;
}

export const MIGRATION_PLAN_SCHEMA_VERSION: 1;
export const MIGRATION_EXECUTION_MODES: readonly MigrationExecutionMode[];
export const MIGRATION_TRANSACTION_STRATEGIES: readonly MigrationTransactionStrategy[];

export function planMigration(diff: SchemaDiff, options?: MigrationPlanOptions): MigrationPlan;
export function migrationAutomaticSteps(plan: MigrationPlan): readonly MigrationStep[];
export function migrationManualSteps(plan: MigrationPlan): readonly MigrationStep[];

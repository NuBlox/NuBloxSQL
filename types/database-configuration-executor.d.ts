import type * as root from '../index';
import type { DatabaseConfigurationDiscovery } from './database-configuration';
import type { DatabaseConfigurationChangePlan, DatabaseConfigurationPlanStep } from './database-configuration-planner';

export type DatabaseConfigurationExecutionStatus =
  | 'dry-run' | 'succeeded' | 'failed' | 'blocked' | 'drifted' | 'pending-verification';

export type DatabaseConfigurationExecutionStepStatus =
  | 'planned' | 'satisfied' | 'succeeded' | 'failed' | 'blocked' | 'pending-verification';

export type DatabaseConfigurationApprovalMode = 'required' | 'none';

export interface DatabaseConfigurationDrift {
  readonly stepId: string;
  readonly name: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly reason: 'setting-missing' | 'value-changed';
}

export interface DatabaseConfigurationPlanInspection {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly targetDialect: root.Dialect;
  readonly checkedSettings: number;
  readonly drift: readonly DatabaseConfigurationDrift[];
  readonly current: DatabaseConfigurationDiscovery;
}

export interface DatabaseConfigurationVerification {
  readonly mode: string;
  readonly name: string | null;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly ok: boolean | null;
  readonly deferred: boolean;
  readonly error: Readonly<{ name: string; message: string }> | null;
  readonly native?: Readonly<Record<string, unknown>>;
}

export interface DatabaseConfigurationExecutionAuditRecord {
  readonly stepId: string;
  readonly action: string;
  readonly name: string | null;
  readonly execution: string;
  readonly sql: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: DatabaseConfigurationExecutionStepStatus;
  readonly verification: DatabaseConfigurationVerification | null;
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export interface DatabaseConfigurationExecutionResult {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly status: DatabaseConfigurationExecutionStatus;
  readonly dryRun: boolean;
  readonly targetDialect: root.Dialect;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly approval: Readonly<{
    mode: DatabaseConfigurationApprovalMode;
    approved: boolean;
    planHashMatched: boolean | null;
  }>;
  readonly preflight: Readonly<{
    checkedSettings: number;
    drift: readonly DatabaseConfigurationDrift[];
  }> | null;
  readonly audit: readonly DatabaseConfigurationExecutionAuditRecord[];
  readonly error: Readonly<{ name: string; message: string; stepId: string | null }> | null;
  readonly reason: string | null;
}

export interface DatabaseConfigurationExecutionOptions {
  readonly dryRun?: boolean;
  readonly approvalMode?: DatabaseConfigurationApprovalMode;
  readonly approvedPlanHash?: string;
  readonly operation?: Readonly<Record<string, unknown>>;
  readonly clock?: () => number;
  readonly closeOpenedVerificationClient?: boolean;
  readonly manualHandler?: (context: Readonly<{
    client: root.Client;
    plan: DatabaseConfigurationChangePlan;
    step: DatabaseConfigurationPlanStep;
    index: number;
  }>) => unknown | Promise<unknown>;
  readonly openVerificationClient?: (context: Readonly<{
    client: root.Client;
    originalClient: root.Client;
    plan: DatabaseConfigurationChangePlan;
    step: DatabaseConfigurationPlanStep;
    targetDialect: root.Dialect;
  }>) => root.Client | Promise<root.Client>;
  readonly beforeStep?: (context: Readonly<{
    client: root.Client;
    plan: DatabaseConfigurationChangePlan;
    step: DatabaseConfigurationPlanStep;
    index: number;
  }>) => void | Promise<void>;
  readonly afterStep?: (context: Readonly<{
    client: root.Client;
    plan: DatabaseConfigurationChangePlan;
    step: DatabaseConfigurationPlanStep;
    index: number;
    verification: DatabaseConfigurationVerification;
  }>) => void | Promise<void>;
  readonly onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

export const DATABASE_CONFIGURATION_EXECUTION_SCHEMA_VERSION: 1;
export const DATABASE_CONFIGURATION_EXECUTION_STATUSES: readonly DatabaseConfigurationExecutionStatus[];
export const DATABASE_CONFIGURATION_EXECUTION_STEP_STATUSES: readonly DatabaseConfigurationExecutionStepStatus[];
export const DATABASE_CONFIGURATION_APPROVAL_MODES: readonly DatabaseConfigurationApprovalMode[];

export function inspectDatabaseConfigurationPlan(
  client: root.Client,
  plan: DatabaseConfigurationChangePlan,
  options?: Pick<DatabaseConfigurationExecutionOptions, 'operation'>
): Promise<DatabaseConfigurationPlanInspection>;

export function executeDatabaseConfiguration(
  client: root.Client,
  plan: DatabaseConfigurationChangePlan,
  options?: DatabaseConfigurationExecutionOptions
): Promise<DatabaseConfigurationExecutionResult>;

declare module './index' {
  interface Client {
    inspectConfigurationPlan(
      plan: DatabaseConfigurationChangePlan,
      options?: Pick<DatabaseConfigurationExecutionOptions, 'operation'>
    ): Promise<DatabaseConfigurationPlanInspection>;
    executeConfiguration(
      plan: DatabaseConfigurationChangePlan,
      options?: DatabaseConfigurationExecutionOptions
    ): Promise<DatabaseConfigurationExecutionResult>;
  }
}

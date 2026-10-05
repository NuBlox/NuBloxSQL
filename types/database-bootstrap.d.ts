import type * as root from '../index';

export type DatabaseBootstrapExecutionMode = 'automatic' | 'manual' | 'satisfied';
export type DatabaseBootstrapScope = 'server' | 'database';
export type DatabaseBootstrapStatus =
  | 'needed' | 'exists' | 'satisfied' | 'manual' | 'deferred'
  | 'planned' | 'skipped' | 'succeeded' | 'failed' | 'blocked';

export interface DatabaseBootstrapDatabaseSpec {
  readonly name: string;
  readonly create?: boolean;
  readonly ifNotExists?: boolean;
}

export interface DatabaseBootstrapSchemaSpec {
  readonly name: string;
  readonly ifNotExists?: boolean;
}

export interface DatabaseBootstrapSpecification {
  readonly dialect?: root.DialectAlias;
  readonly database?: string | DatabaseBootstrapDatabaseSpec;
  readonly schemas?: readonly (string | DatabaseBootstrapSchemaSpec)[];
}

export interface DatabaseBootstrapCheck {
  readonly mode: 'absent' | 'present';
  readonly sql: string;
}

export interface DatabaseBootstrapStepRequirements {
  readonly autocommit?: boolean;
  readonly transactionForbidden?: boolean;
  readonly onlyStatementBatch?: boolean;
  readonly reconnectAfter?: boolean;
  readonly adminPrivileges?: boolean;
  readonly databaseEquivalent?: boolean;
}

export interface DatabaseBootstrapStep {
  readonly id: string;
  readonly phase: number;
  readonly kind: 'database' | 'schema';
  readonly action: 'create';
  readonly scope: DatabaseBootstrapScope;
  readonly execution: DatabaseBootstrapExecutionMode;
  readonly sql: string | null;
  readonly precondition: DatabaseBootstrapCheck | null;
  readonly verification: DatabaseBootstrapCheck | null;
  readonly requirements: Readonly<DatabaseBootstrapStepRequirements>;
  readonly notes: string | null;
}

export interface DatabaseBootstrapPlan {
  readonly schemaVersion: 1;
  readonly planHash: string;
  readonly targetDialect: root.Dialect;
  readonly targetDatabase: string | null;
  readonly executable: boolean;
  readonly requires: Readonly<{
    serverClient: boolean;
    databaseClientAfterCreate: boolean;
    autocommitBoundary: boolean;
  }>;
  readonly summary: Readonly<{
    steps: number;
    automatic: number;
    manual: number;
    satisfied: number;
    server: number;
    database: number;
  }>;
  readonly steps: readonly DatabaseBootstrapStep[];
}

export interface DatabaseBootstrapFinding {
  readonly stepId: string;
  readonly kind: string;
  readonly scope: DatabaseBootstrapScope;
  readonly execution: DatabaseBootstrapExecutionMode;
  readonly status: 'needed' | 'exists' | 'satisfied' | 'manual' | 'deferred';
  readonly exists: boolean | null;
  readonly notes: string | null;
}

export interface DatabaseBootstrapInspection {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly targetDialect: root.Dialect;
  readonly targetDatabase: string | null;
  readonly summary: Readonly<{
    steps: number;
    needed: number;
    exists: number;
    satisfied: number;
    manual: number;
    deferred: number;
  }>;
  readonly findings: readonly DatabaseBootstrapFinding[];
}

export interface DatabaseBootstrapAuditRecord {
  readonly stepId: string;
  readonly kind: string;
  readonly scope: DatabaseBootstrapScope;
  readonly execution: DatabaseBootstrapExecutionMode;
  readonly sql: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: DatabaseBootstrapStatus;
  readonly verification: Readonly<{ mode: string; ok: boolean | null }> | null;
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export interface DatabaseBootstrapExecutionResult {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly status: 'dry-run' | 'succeeded' | 'failed' | 'blocked';
  readonly dryRun: boolean;
  readonly targetDialect: root.Dialect;
  readonly targetDatabase: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly audit: readonly DatabaseBootstrapAuditRecord[];
  readonly error: Readonly<{ name: string; message: string; stepId: string | null }> | null;
  readonly reason: string | null;
}

export interface DatabaseBootstrapExecutionOptions {
  readonly dryRun?: boolean;
  readonly databaseClient?: root.Client;
  readonly openDatabaseClient?: (context: Readonly<{
    serverClient: root.Client;
    plan: DatabaseBootstrapPlan;
    targetDialect: root.Dialect;
    targetDatabase: string | null;
  }>) => root.Client | Promise<root.Client>;
  readonly closeOpenedDatabaseClient?: boolean;
  readonly operation?: Readonly<Record<string, unknown>>;
  readonly clock?: () => number;
  readonly manualHandler?: (context: Readonly<{
    serverClient: root.Client;
    databaseClient: root.Client | null;
    plan: DatabaseBootstrapPlan;
    step: DatabaseBootstrapStep;
    index: number;
  }>) => unknown | Promise<unknown>;
  readonly beforeStep?: (context: Readonly<{
    client: root.Client;
    serverClient: root.Client;
    plan: DatabaseBootstrapPlan;
    step: DatabaseBootstrapStep;
    index: number;
  }>) => void | Promise<void>;
  readonly afterStep?: (context: Readonly<{
    client: root.Client;
    serverClient: root.Client;
    plan: DatabaseBootstrapPlan;
    step: DatabaseBootstrapStep;
    index: number;
  }>) => void | Promise<void>;
  readonly onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

export interface DatabaseBootstrapPlanOptions {
  readonly targetDialect?: root.DialectAlias;
}

export const DATABASE_BOOTSTRAP_PLAN_SCHEMA_VERSION: 1;
export const DATABASE_BOOTSTRAP_EXECUTION_MODES: readonly DatabaseBootstrapExecutionMode[];
export const DATABASE_BOOTSTRAP_SCOPES: readonly DatabaseBootstrapScope[];
export const DATABASE_BOOTSTRAP_EXECUTION_SCHEMA_VERSION: 1;
export const DATABASE_BOOTSTRAP_STATUSES: readonly DatabaseBootstrapStatus[];

export function planDatabaseBootstrap(
  specification: DatabaseBootstrapSpecification,
  options?: DatabaseBootstrapPlanOptions
): DatabaseBootstrapPlan;
export function bootstrapAutomaticSteps(plan: DatabaseBootstrapPlan): readonly DatabaseBootstrapStep[];
export function bootstrapManualSteps(plan: DatabaseBootstrapPlan): readonly DatabaseBootstrapStep[];
export function inspectDatabaseBootstrap(
  serverClient: root.Client,
  plan: DatabaseBootstrapPlan,
  options?: Pick<DatabaseBootstrapExecutionOptions, 'databaseClient' | 'operation'>
): Promise<DatabaseBootstrapInspection>;
export function executeDatabaseBootstrap(
  serverClient: root.Client,
  plan: DatabaseBootstrapPlan,
  options?: DatabaseBootstrapExecutionOptions
): Promise<DatabaseBootstrapExecutionResult>;

declare module './index' {
  interface Client {
    planBootstrap(specification: DatabaseBootstrapSpecification, options?: DatabaseBootstrapPlanOptions): DatabaseBootstrapPlan;
    inspectBootstrap(
      plan: DatabaseBootstrapPlan,
      options?: Pick<DatabaseBootstrapExecutionOptions, 'databaseClient' | 'operation'>
    ): Promise<DatabaseBootstrapInspection>;
    executeBootstrap(plan: DatabaseBootstrapPlan, options?: DatabaseBootstrapExecutionOptions): Promise<DatabaseBootstrapExecutionResult>;
  }
}

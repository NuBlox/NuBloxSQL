import type * as root from '../index';
import type { DatabaseConfigurationDiscovery, DatabaseConfigurationScope } from './database-configuration';

export type DatabaseConfigurationPlanExecution = 'automatic' | 'manual' | 'satisfied';
export type DatabaseConfigurationPlanAction = 'set' | 'reload' | 'restart';

export interface DatabaseConfigurationChange {
  readonly name: string;
  readonly value: unknown;
}

export interface DatabaseConfigurationChangeSpecification {
  readonly changes: readonly DatabaseConfigurationChange[];
}

export interface DatabaseConfigurationPlanStepRequirements {
  readonly adminPrivileges: boolean;
  readonly transactionForbidden: boolean;
  readonly reloadRequired: boolean;
  readonly restartRequired: boolean;
  readonly reconnectRequired: boolean;
}

export interface DatabaseConfigurationPlanStep {
  readonly id: string;
  readonly kind: 'configuration';
  readonly action: DatabaseConfigurationPlanAction;
  readonly name: string | null;
  readonly from: unknown;
  readonly to: unknown;
  readonly scope: DatabaseConfigurationScope;
  readonly execution: DatabaseConfigurationPlanExecution;
  readonly sql: string | null;
  readonly verification: Readonly<{
    mode: 'setting-equals';
    name: string;
    value: unknown;
  }> | null;
  readonly requirements: Readonly<DatabaseConfigurationPlanStepRequirements>;
  readonly notes: string | null;
}

export interface DatabaseConfigurationChangePlan {
  readonly schemaVersion: 1;
  readonly discoverySchemaVersion: 1;
  readonly planHash: string;
  readonly targetDialect: root.Dialect;
  readonly executable: boolean;
  readonly requires: Readonly<{
    adminPrivileges: boolean;
    reload: boolean;
    restart: boolean;
    reconnect: boolean;
    transactionBoundary: boolean;
  }>;
  readonly summary: Readonly<{
    steps: number;
    automatic: number;
    manual: number;
    satisfied: number;
  }>;
  readonly steps: readonly DatabaseConfigurationPlanStep[];
}

export interface DatabaseConfigurationPlanOptions {
  readonly targetDialect?: root.DialectAlias;
}

export const DATABASE_CONFIGURATION_PLAN_SCHEMA_VERSION: 1;
export const DATABASE_CONFIGURATION_PLAN_EXECUTION_MODES: readonly DatabaseConfigurationPlanExecution[];
export const DATABASE_CONFIGURATION_PLAN_ACTIONS: readonly DatabaseConfigurationPlanAction[];

export function planDatabaseConfiguration(
  discovery: DatabaseConfigurationDiscovery,
  specification: DatabaseConfigurationChangeSpecification,
  options?: DatabaseConfigurationPlanOptions
): DatabaseConfigurationChangePlan;

export function configurationAutomaticSteps(
  plan: DatabaseConfigurationChangePlan
): readonly DatabaseConfigurationPlanStep[];

export function configurationManualSteps(
  plan: DatabaseConfigurationChangePlan
): readonly DatabaseConfigurationPlanStep[];

declare module './index' {
  interface Client {
    planConfiguration(
      discovery: DatabaseConfigurationDiscovery,
      specification: DatabaseConfigurationChangeSpecification,
      options?: DatabaseConfigurationPlanOptions
    ): DatabaseConfigurationChangePlan;
  }
}

import type * as root from '../index';

export type EngineLifecycleEngine = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';
export type EngineLifecycleExecutionMode = 'provider' | 'external' | 'manual' | 'satisfied' | 'blocked';
export type InstallationProviderAction =
  | 'inspect-target' | 'install' | 'verify-install' | 'initialize' | 'verify-initialize'
  | 'upgrade' | 'verify-upgrade' | 'uninstall' | 'verify-uninstall';

export interface EngineLifecycleProfile {
  readonly engine: EngineLifecycleEngine;
  readonly runtimeKind: 'server' | 'embedded';
  readonly initializationModel: 'cluster' | 'data-directory' | 'instance' | 'database-file';
  readonly installationStrategies: readonly string[];
  readonly initializationAction: string;
}

export interface EngineSelectionSpecification {
  readonly engine?: root.DialectAlias;
  readonly dialect?: root.DialectAlias;
  readonly targetVersion: string;
  readonly edition?: string;
  readonly distribution?: string;
  readonly installationStrategy?: string;
  readonly components?: readonly string[];
}

export interface EngineSelection {
  readonly schemaVersion: 1;
  readonly selectionHash: string;
  readonly engine: EngineLifecycleEngine;
  readonly dialect: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly edition: string | null;
  readonly distribution: string | null;
  readonly installationStrategy: string;
  readonly components: readonly string[];
  readonly runtimeKind: 'server' | 'embedded';
  readonly initializationModel: 'cluster' | 'data-directory' | 'instance' | 'database-file';
}

export interface InstallationProviderInstalledEvidence {
  readonly engine: EngineLifecycleEngine;
  readonly version: string;
  readonly state: string;
  readonly edition: string | null;
  readonly distribution: string | null;
  readonly components: readonly string[];
  readonly native: Readonly<Record<string, unknown>>;
}

export interface InstallationProviderResourceEvidence {
  readonly engine: EngineLifecycleEngine;
  readonly key: string;
  readonly state: string;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface InstallationProviderTargetInspection {
  readonly schemaVersion: 1;
  readonly inspectionHash: string;
  readonly provider: InstallationProviderDescriptor;
  readonly targetId: string | null;
  readonly platform: Readonly<{
    os: string | null;
    family: string | null;
    version: string | null;
    architecture: string | null;
  }>;
  readonly elevated: boolean | null;
  readonly installed: readonly InstallationProviderInstalledEvidence[];
  readonly resources: readonly InstallationProviderResourceEvidence[];
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface InstallationProviderDescriptor {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: string;
  readonly actions: readonly InstallationProviderAction[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type EngineLifecycleActionResultStatus =
  | 'succeeded' | 'failed' | 'blocked'
  | 'pending-restart' | 'pending-reboot' | 'pending-verification';

export interface EngineLifecycleProviderActionRequest {
  readonly schemaVersion: 1;
  readonly action: 'install' | 'initialize';
  readonly phase: 'install' | 'initialize';
  readonly planHash: string;
  readonly selectionHash: string;
  readonly targetInspectionHash: string;
  readonly stepId: string;
  readonly engine: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly targetId: string | null;
  readonly requirements: Readonly<EngineLifecycleStepRequirements>;
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly licenseAcceptance: Readonly<{ accepted: true; reference: string | null }> | null;
  readonly inputs: Readonly<Record<string, unknown>> | null;
}

export interface EngineLifecycleActionResult {
  readonly status: EngineLifecycleActionResultStatus;
  readonly message?: string;
  readonly reference?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface EngineInstallationProvider {
  readonly id: string;
  readonly kind?: string;
  readonly actions?: readonly InstallationProviderAction[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  inspectTarget(request: Readonly<Record<string, unknown>>): unknown | Promise<unknown>;
  executeAction?(request: EngineLifecycleProviderActionRequest): EngineLifecycleActionResult | Promise<EngineLifecycleActionResult>;
}

export interface EngineLifecycleStepRequirements {
  readonly hostMutation: boolean;
  readonly elevatedPrivileges: boolean;
  readonly licenseAcceptance?: boolean;
  readonly serviceInterruption?: boolean;
  readonly rebootPossible?: boolean;
  readonly serviceStartOrRestart?: boolean;
  readonly destructive: boolean;
  readonly secureBootstrap?: boolean;
}

export interface EngineLifecyclePlanStep {
  readonly id: string;
  readonly phase: 'install' | 'initialize';
  readonly action: string;
  readonly execution: EngineLifecycleExecutionMode;
  readonly requirements: Readonly<EngineLifecycleStepRequirements>;
  readonly notes: string | null;
  readonly evidence: InstallationProviderInstalledEvidence | InstallationProviderResourceEvidence | null;
}

export interface EngineInstallationPlan {
  readonly schemaVersion: 1;
  readonly planHash: string;
  readonly selectionHash: string;
  readonly targetInspectionHash: string;
  readonly engine: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly targetId: string | null;
  readonly provider: InstallationProviderDescriptor;
  readonly executable: boolean;
  readonly requires: Readonly<{
    hostMutation: boolean;
    elevatedPrivileges: boolean;
    licenseAcceptance: boolean;
    serviceInterruption: boolean;
    rebootPossible: boolean;
  }>;
  readonly summary: Readonly<{
    steps: number;
    provider: number;
    external: number;
    manual: number;
    satisfied: number;
    blocked: number;
  }>;
  readonly steps: readonly EngineLifecyclePlanStep[];
}


export interface EngineInitializationSpecification {
  readonly dataDirectory?: string;
  readonly instanceName?: string;
  readonly filename?: string;
  readonly secureBootstrap?: boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface EngineInitializationPlan {
  readonly schemaVersion: 1;
  readonly planHash: string;
  readonly selectionHash: string;
  readonly targetInspectionHash: string;
  readonly engine: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly targetId: string | null;
  readonly provider: InstallationProviderDescriptor;
  readonly resourceKey: string;
  readonly executable: boolean;
  readonly requires: Readonly<{
    hostMutation: boolean;
    elevatedPrivileges: boolean;
    serviceStartOrRestart: boolean;
    secureBootstrap: boolean;
  }>;
  readonly summary: Readonly<{
    steps: number;
    provider: number;
    external: number;
    manual: number;
    satisfied: number;
    blocked: number;
  }>;
  readonly steps: readonly EngineLifecyclePlanStep[];
}

export const ENGINE_LIFECYCLE_SCHEMA_VERSION: 1;
export const ENGINE_LIFECYCLE_ENGINES: readonly EngineLifecycleEngine[];
export const ENGINE_LIFECYCLE_EXECUTION_MODES: readonly EngineLifecycleExecutionMode[];
export const INSTALLATION_PROVIDER_SCHEMA_VERSION: 1;
export const INSTALLATION_PROVIDER_ACTIONS: readonly InstallationProviderAction[];
export const ENGINE_INSTALLATION_PLAN_SCHEMA_VERSION: 1;
export const ENGINE_INITIALIZATION_PLAN_SCHEMA_VERSION: 1;

export function engineLifecycleProfile(engine: root.DialectAlias): EngineLifecycleProfile;
export function selectDatabaseEngine(specification: EngineSelectionSpecification): EngineSelection;
export function validateInstallationProvider(provider: EngineInstallationProvider): EngineInstallationProvider;
export function installationProviderDescriptor(provider: EngineInstallationProvider): InstallationProviderDescriptor;
export function inspectEngineTarget(
  provider: EngineInstallationProvider,
  request?: Readonly<Record<string, unknown>>
): Promise<InstallationProviderTargetInspection>;
export function planEngineInstallation(
  selection: EngineSelection,
  target: InstallationProviderTargetInspection
): EngineInstallationPlan;
export function engineInstallationProviderSteps(plan: EngineInstallationPlan): readonly EngineLifecyclePlanStep[];
export function engineInstallationExternalSteps(plan: EngineInstallationPlan): readonly EngineLifecyclePlanStep[];
export function planEngineInitialization(
  selection: EngineSelection,
  target: InstallationProviderTargetInspection,
  specification: EngineInitializationSpecification
): EngineInitializationPlan;


export type EngineLifecycleExecutionStatus =
  | 'dry-run' | 'succeeded' | 'failed' | 'blocked' | 'drifted'
  | 'pending-restart' | 'pending-reboot' | 'pending-verification';

export type EngineLifecycleExecutionStepStatus =
  | 'planned' | 'satisfied' | 'succeeded' | 'failed' | 'blocked'
  | 'pending-restart' | 'pending-reboot' | 'pending-verification';

export type EngineLifecycleApprovalMode = 'required' | 'none';

export interface EngineLifecyclePlanDrift {
  readonly reason: 'target-id-changed' | 'target-state-changed';
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface EngineLifecyclePlanInspection {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly kind: 'installation' | 'initialization';
  readonly engine: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly targetId: string | null;
  readonly plannedInspectionHash: string;
  readonly currentInspectionHash: string;
  readonly drift: readonly EngineLifecyclePlanDrift[];
  readonly current: InstallationProviderTargetInspection;
}

export interface EngineLifecycleVerification {
  readonly mode: 'target-reinspection';
  readonly action: 'verify-install' | 'verify-initialize';
  readonly ok: boolean;
  readonly inspectionHash: string;
  readonly reason: string | null;
  readonly evidence: Readonly<Record<string, unknown>> | null;
}

export interface EngineLifecycleExecutionAuditRecord {
  readonly stepId: string;
  readonly phase: 'install' | 'initialize';
  readonly action: string;
  readonly execution: EngineLifecycleExecutionMode;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: EngineLifecycleExecutionStepStatus;
  readonly result: EngineLifecycleActionResult | null;
  readonly verification: EngineLifecycleVerification | null;
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export interface EngineLifecycleExecutionResult {
  readonly schemaVersion: 1;
  readonly planSchemaVersion: 1;
  readonly planHash: string;
  readonly kind: 'installation' | 'initialization';
  readonly status: EngineLifecycleExecutionStatus;
  readonly dryRun: boolean;
  readonly engine: EngineLifecycleEngine;
  readonly targetVersion: string;
  readonly targetId: string | null;
  readonly approval: Readonly<{
    mode: EngineLifecycleApprovalMode;
    approved: boolean;
    planHashMatched: boolean | null;
  }>;
  readonly licenseAcceptance: Readonly<{
    required: boolean;
    accepted: boolean | null;
    reference: string | null;
  }>;
  readonly preflight: Readonly<{
    plannedInspectionHash: string;
    currentInspectionHash: string;
    drift: readonly EngineLifecyclePlanDrift[];
  }> | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly audit: readonly EngineLifecycleExecutionAuditRecord[];
  readonly error: Readonly<{ name: string; message: string; stepId: string | null }> | null;
  readonly reason: string | null;
}

export interface EngineLifecycleExecutionOptions {
  readonly dryRun?: boolean;
  readonly approvalMode?: EngineLifecycleApprovalMode;
  readonly approvedPlanHash?: string;
  readonly licenseAcceptance?: Readonly<{
    accepted: boolean;
    reference?: string;
  }>;
  readonly clock?: () => number;
  readonly resolveInputs?: (context: Readonly<{
    phase: 'install' | 'initialize';
    action: 'install' | 'initialize' | null;
    planHash: string;
    stepId: string;
    engine: EngineLifecycleEngine;
    targetVersion: string;
    targetId: string | null;
    index: number;
  }>) => Readonly<Record<string, unknown>> | null | undefined | Promise<Readonly<Record<string, unknown>> | null | undefined>;
  readonly manualHandler?: (context: Readonly<{
    provider: EngineInstallationProvider;
    plan: EngineInstallationPlan | EngineInitializationPlan;
    step: EngineLifecyclePlanStep;
    index: number;
    inputs: Readonly<Record<string, unknown>> | null;
  }>) => EngineLifecycleActionResult | Promise<EngineLifecycleActionResult>;
  readonly externalHandler?: (context: Readonly<{
    provider: EngineInstallationProvider;
    plan: EngineInstallationPlan | EngineInitializationPlan;
    step: EngineLifecyclePlanStep;
    index: number;
    inputs: Readonly<Record<string, unknown>> | null;
  }>) => EngineLifecycleActionResult | Promise<EngineLifecycleActionResult>;
  readonly beforeStep?: (context: Readonly<{
    provider: EngineInstallationProvider;
    plan: EngineInstallationPlan | EngineInitializationPlan;
    step: EngineLifecyclePlanStep;
    index: number;
  }>) => void | Promise<void>;
  readonly afterStep?: (context: Readonly<{
    provider: EngineInstallationProvider;
    plan: EngineInstallationPlan | EngineInitializationPlan;
    step: EngineLifecyclePlanStep;
    index: number;
    audit: EngineLifecycleExecutionAuditRecord;
  }>) => void | Promise<void>;
  readonly onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

export const ENGINE_LIFECYCLE_EXECUTION_SCHEMA_VERSION: 1;
export const ENGINE_LIFECYCLE_EXECUTION_STATUSES: readonly EngineLifecycleExecutionStatus[];
export const ENGINE_LIFECYCLE_EXECUTION_STEP_STATUSES: readonly EngineLifecycleExecutionStepStatus[];
export const ENGINE_LIFECYCLE_APPROVAL_MODES: readonly EngineLifecycleApprovalMode[];
export const ENGINE_LIFECYCLE_ACTION_RESULT_STATUSES: readonly EngineLifecycleActionResultStatus[];

export function inspectEngineInstallationPlan(
  provider: EngineInstallationProvider,
  plan: EngineInstallationPlan
): Promise<EngineLifecyclePlanInspection>;

export function inspectEngineInitializationPlan(
  provider: EngineInstallationProvider,
  plan: EngineInitializationPlan
): Promise<EngineLifecyclePlanInspection>;

export function executeEngineInstallation(
  provider: EngineInstallationProvider,
  plan: EngineInstallationPlan,
  options?: EngineLifecycleExecutionOptions
): Promise<EngineLifecycleExecutionResult>;

export function executeEngineInitialization(
  provider: EngineInstallationProvider,
  plan: EngineInitializationPlan,
  options?: EngineLifecycleExecutionOptions
): Promise<EngineLifecycleExecutionResult>;

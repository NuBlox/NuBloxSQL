import type { SqlCapabilityFeature, SqlCapabilitySupportLevel, SqlCapabilityModelApi } from './public';
import type { DialectRegistryImplementation } from './dialect-registry';

export type ProfileCapabilityChangeType = 'add' | 'override' | 'remove';
export type ProfileCapabilityEvidenceLevel = 'qualified' | 'documented' | 'declared';
export type ProfileCapabilityResolution =
  | 'base-qualified'
  | 'overlay-qualified'
  | 'overlay-documented'
  | 'overlay-declared'
  | 'inherited-unverified'
  | 'baseline-unavailable'
  | 'capability-absent';

export interface ProfileCapabilityContext {
  readonly version?: string;
  readonly edition?: string;
  readonly deployment?: string;
}

export interface ProfileCapabilityChangeInput {
  readonly path: string;
  readonly operation?: ProfileCapabilityChangeType;
  readonly support?: SqlCapabilitySupportLevel;
  readonly evidence?: ProfileCapabilityEvidenceLevel;
  readonly since?: string;
  readonly until?: string;
  readonly deployments?: readonly string[];
  readonly editions?: readonly string[];
  readonly nativeName?: string;
  readonly syntax?: string;
  readonly standard?: string;
  readonly references?: readonly string[];
  readonly restrictions?: readonly string[];
  readonly aliases?: readonly string[];
  readonly equivalentTo?: readonly string[];
  readonly notes?: string;
}

export interface ProfileCapabilityChange {
  readonly path: string;
  readonly operation: ProfileCapabilityChangeType;
  readonly support: SqlCapabilitySupportLevel;
  readonly evidence: ProfileCapabilityEvidenceLevel;
  readonly since: string | null;
  readonly until: string | null;
  readonly deployments: readonly string[];
  readonly editions: readonly string[];
  readonly nativeName: string | null;
  readonly syntax: string | null;
  readonly standard: string | null;
  readonly references: readonly string[];
  readonly restrictions: readonly string[];
  readonly aliases: readonly string[];
  readonly equivalentTo: readonly string[];
  readonly notes: string | null;
}

export interface ProfileCapabilityOverlayInput {
  readonly verification?: string;
  readonly wireProtocol?: Readonly<{ status: string; family: string | null }>;
  readonly deployments?: readonly string[];
  readonly changes?: readonly ProfileCapabilityChangeInput[];
  readonly evidence?: readonly string[];
}

export interface ProfileCapabilityOverlay {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly product: string;
  readonly canonicalDialect: string;
  readonly baseDialect: 'postgresql' | 'mysql' | 'sqlite' | null;
  readonly verification: string;
  readonly wireProtocol: Readonly<{ status: string; family: string | null }>;
  readonly deployments: readonly string[];
  readonly changes: readonly ProfileCapabilityChange[];
  readonly evidence: readonly string[];
}

export interface ProfileCapabilityDefinition {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly vendor: string;
  readonly product: string;
  readonly profileDialect: string;
  readonly canonicalDialect: string;
  readonly baseDialect: 'postgresql' | 'mysql' | 'sqlite' | null;
  readonly inheritance: readonly string[];
  readonly driver: DialectRegistryImplementation;
  readonly wireProtocol: Readonly<{ status: string; family: string | null }>;
  readonly verification: string;
  readonly changeCount: number;
  readonly evidence: readonly string[];
}

export interface ProfileCapabilityStatus {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly path: string;
  readonly baseDialect: 'postgresql' | 'mysql' | 'sqlite' | null;
  readonly resolution: ProfileCapabilityResolution;
  readonly available: boolean | null;
  readonly feature: SqlCapabilityFeature | null;
  readonly baseline: SqlCapabilityFeature | null;
  readonly change: ProfileCapabilityChange | null;
  readonly context: Readonly<ProfileCapabilityContext>;
}

export interface ProfileCapabilityReport {
  readonly schemaVersion: 1;
  readonly definition: ProfileCapabilityDefinition;
  readonly summary: Readonly<{
    total: number;
    baseQualified: number;
    overlayQualified: number;
    overlayDocumented: number;
    overlayDeclared: number;
    inheritedUnverified: number;
    baselineUnavailable: number;
    capabilityAbsent: number;
  }>;
  readonly changes: readonly ProfileCapabilityChange[];
}

export interface ProfileCapabilityApi {
  readonly SCHEMA_VERSION: 1;
  readonly CHANGE_TYPES: readonly ProfileCapabilityChangeType[];
  readonly EVIDENCE_LEVELS: readonly ProfileCapabilityEvidenceLevel[];
  readonly RESOLUTIONS: readonly ProfileCapabilityResolution[];
  definition(profileId: string): ProfileCapabilityDefinition;
  compile(profileId: string, specification?: ProfileCapabilityOverlayInput): ProfileCapabilityOverlay;
  overlay(profileId: string): ProfileCapabilityOverlay;
  status(profileId: string, path: string, options?: {
    readonly overlay?: ProfileCapabilityOverlay;
    readonly context?: ProfileCapabilityContext;
  }): ProfileCapabilityStatus;
  supports(profileId: string, path: string, options?: {
    readonly overlay?: ProfileCapabilityOverlay;
    readonly context?: ProfileCapabilityContext;
  }): boolean | null;
  diff(profileId: string, options?: { readonly overlay?: ProfileCapabilityOverlay }): Readonly<{
    schemaVersion: 1;
    profileId: string;
    baseDialect: 'postgresql' | 'mysql' | 'sqlite' | null;
    changes: readonly ProfileCapabilityChange[];
  }>;
  report(profileId: string, options?: {
    readonly overlay?: ProfileCapabilityOverlay;
    readonly context?: ProfileCapabilityContext;
  }): ProfileCapabilityReport;
  validate(): Readonly<{
    valid: boolean;
    schemaVersion: 1;
    profiles: number;
    officialOverlays: number;
    errors: readonly string[];
  }>;
  compareVersion(left: string, right: string): -1 | 0 | 1 | null;
}

export const PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION: 1;
export const PROFILE_CAPABILITY_CHANGE_TYPES: readonly ProfileCapabilityChangeType[];
export const PROFILE_CAPABILITY_RESOLUTIONS: readonly ProfileCapabilityResolution[];
export const profileCapabilities: ProfileCapabilityApi;

declare module './public' {
  interface SqlCapabilityModelApi {
    readonly profileCapabilities: ProfileCapabilityApi;
  }
}

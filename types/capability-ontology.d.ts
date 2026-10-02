import type { SqlCapabilityTier1Dialect } from './public';

export type SqlOntologySupportLevel =
  | 'native' | 'partial' | 'emulated' | 'unsupported' | 'unknown' | 'not-applicable';

export type SqlCapabilityAvailabilityKind =
  | 'unconditional' | 'version-dependent' | 'edition-dependent' | 'deployment-dependent'
  | 'engine-dependent' | 'connector-dependent' | 'extension-dependent'
  | 'component-dependent' | 'configuration-dependent';

export type SqlCapabilityMaturity = 'stable' | 'preview' | 'experimental' | 'deprecated' | 'removed';
export type SqlCapabilityImplementationLevel = 'implemented' | 'partial' | 'unsupported' | 'not-applicable';
export type SqlCapabilityKind =
  | 'syntax' | 'semantic' | 'datatype' | 'object' | 'constraint' | 'security'
  | 'transaction' | 'physical' | 'operational' | 'programmability' | 'function'
  | 'operator' | 'extension';
export type SqlCapabilityPortability = 'standard' | 'common' | 'vendor-extension' | 'vendor-specific' | 'unclassified';

export interface SqlCapabilityRelationships {
  readonly requires: readonly string[];
  readonly implies: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly relatedTo: readonly string[];
}

export interface SqlCapabilityDefinition {
  readonly id: string;
  readonly family: string;
  readonly name: string;
  readonly kind: SqlCapabilityKind;
  readonly description: string;
  readonly portability: SqlCapabilityPortability;
  readonly aliases: readonly string[];
  readonly relationships: SqlCapabilityRelationships;
}

export interface SqlCapabilitySubject {
  readonly dialect: SqlCapabilityTier1Dialect;
  readonly version: string | null;
  readonly edition: string | null;
  readonly deployment: string | null;
  readonly connector: string | null;
  readonly extension: string | null;
}

export interface SqlCapabilityAvailability {
  readonly kind: SqlCapabilityAvailabilityKind;
  readonly conditions: readonly string[];
}

export interface SqlCapabilityObservation {
  readonly capabilityId: string;
  readonly subject: SqlCapabilitySubject;
  readonly support: SqlOntologySupportLevel;
  readonly maturity: SqlCapabilityMaturity;
  readonly availability: SqlCapabilityAvailability;
  readonly since: string | null;
  readonly until: string | null;
  readonly syntax: Readonly<{
    nativeName: string | null;
    canonical: string | null;
    aliases: readonly string[];
  }>;
  readonly semantics: Readonly<{
    equivalent: boolean;
    equivalentTo: readonly string[];
    restrictions: readonly string[];
    notes: string | null;
    standard: string | null;
  }>;
  readonly evidence: Readonly<{
    classification: string;
    documentation: readonly string[];
  }>;
  readonly legacy: Readonly<{
    path: string;
    support: string;
    supported: boolean | null;
  }>;
}

export interface SqlCapabilityImplementationCoverage {
  readonly capabilityId: string;
  readonly scope: string | null;
  readonly stages: Readonly<{
    parser: SqlCapabilityImplementationLevel;
    ast: SqlCapabilityImplementationLevel;
    validator: SqlCapabilityImplementationLevel;
    renderer: SqlCapabilityImplementationLevel;
    rewrite: SqlCapabilityImplementationLevel;
    runtime: SqlCapabilityImplementationLevel;
  }>;
  readonly qualified: boolean;
  readonly evidence: readonly string[];
}

export interface SqlCapabilityResolution {
  readonly capabilityId: string;
  readonly subject: SqlCapabilitySubject;
  readonly support: SqlOntologySupportLevel;
  readonly maturity: SqlCapabilityMaturity;
  readonly availability: SqlCapabilityAvailability;
  readonly available: boolean | null;
  readonly reason: string;
  readonly implementation: SqlCapabilityImplementationCoverage | null;
}

export interface SqlCapabilityProfile {
  readonly schemaVersion: 1;
  readonly dialect: SqlCapabilityTier1Dialect;
  readonly subject: SqlCapabilitySubject;
  readonly summary: Readonly<{
    total: number;
    native: number;
    partial: number;
    emulated: number;
    unsupported: number;
    unknown: number;
    notApplicable: number;
    conditional: number;
  }>;
  readonly observations: readonly SqlCapabilityObservation[];
}

export interface SqlCapabilityInventoryEntry {
  readonly definition: SqlCapabilityDefinition;
  readonly observation: SqlCapabilityObservation | null;
  readonly implementation: SqlCapabilityImplementationCoverage;
}

export interface SqlCapabilityOntologyApi {
  readonly schemaVersion: 1;
  readonly supportLevels: readonly SqlOntologySupportLevel[];
  readonly availabilityKinds: readonly SqlCapabilityAvailabilityKind[];
  readonly maturityLevels: readonly SqlCapabilityMaturity[];
  readonly implementationLevels: readonly SqlCapabilityImplementationLevel[];
  readonly capabilityKinds: readonly SqlCapabilityKind[];
  readonly portabilityLevels: readonly SqlCapabilityPortability[];
  ids(options?: { family?: string; kind?: SqlCapabilityKind }): readonly string[];
  definition(id: string): SqlCapabilityDefinition | null;
  observation(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', id: string): SqlCapabilityObservation | null;
  observations(id: string): Readonly<Partial<Record<SqlCapabilityTier1Dialect, SqlCapabilityObservation>>>;
  implementation(id: string): SqlCapabilityImplementationCoverage | null;
  resolve(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', id: string, context?: { version?: string }): SqlCapabilityResolution | null;
  profile(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg'): SqlCapabilityProfile;
  inventory(options?: { dialect?: SqlCapabilityTier1Dialect | 'postgres' | 'pg'; family?: string; kind?: SqlCapabilityKind }): readonly SqlCapabilityInventoryEntry[];
  validate(): Readonly<{ valid: true; definitions: number; observations: number }>;
}

export const SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION: 1;
export const capabilityOntology: SqlCapabilityOntologyApi;

declare module './public' {
  interface SqlCapabilityModelApi {
    readonly ontology: SqlCapabilityOntologyApi;
  }
}

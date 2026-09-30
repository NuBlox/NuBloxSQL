export * from './index';

export type SqlCapabilityTier1Dialect = 'postgresql' | 'mysql' | 'sqlite';
export type SqlCapabilitySupportLevel =
  | 'native'
  | 'equivalent'
  | 'emulated'
  | 'partial'
  | 'runtime-dependent'
  | 'unsupported'
  | 'unknown'
  | 'not-applicable';
export type SqlCapabilityCoverageLevel = 'foundation' | 'exhaustive-v1';
export type SqlCapabilityCategory =
  | 'statements' | 'queries' | 'schema' | 'expressions' | 'integrity' | 'physical'
  | 'security' | 'transactions' | 'programmability' | 'administration' | 'dataMovement'
  | 'extensions' | 'types' | 'functions' | 'operators' | 'keywords' | 'syntax' | 'limits';

export interface SqlCapabilityFeature {
  readonly supported: boolean | null;
  readonly support: SqlCapabilitySupportLevel;
  readonly nativeName: string | null;
  readonly since: string | null;
  readonly deprecatedSince: string | null;
  readonly syntax: string | null;
  readonly standard: string | null;
  readonly evidence: string;
  readonly references: readonly string[];
  readonly restrictions: readonly string[];
  readonly aliases: readonly string[];
  readonly equivalentTo: readonly string[];
  readonly notes: string | null;
}

export interface SqlDialectCapabilityModel {
  readonly schemaVersion: 1;
  readonly dialect: SqlCapabilityTier1Dialect;
  readonly tier: 1;
  readonly coverage: SqlCapabilityCoverageLevel;
  readonly identity: Readonly<{ family: string; name: string; referenceVersion: string; versionPolicy: string }>;
  readonly categories: readonly SqlCapabilityCategory[];
  readonly evidenceRegister: readonly string[];
  readonly statements: Readonly<Record<string, unknown>>;
  readonly queries: Readonly<Record<string, unknown>>;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly expressions: Readonly<Record<string, unknown>>;
  readonly integrity: Readonly<Record<string, unknown>>;
  readonly physical: Readonly<Record<string, unknown>>;
  readonly security: Readonly<Record<string, unknown>>;
  readonly transactions: Readonly<Record<string, unknown>>;
  readonly programmability: Readonly<Record<string, unknown>>;
  readonly administration: Readonly<Record<string, unknown>>;
  readonly dataMovement: Readonly<Record<string, unknown>>;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, unknown>>;
  readonly functions: Readonly<Record<string, unknown>>;
  readonly operators: Readonly<Record<string, unknown>>;
  readonly keywords: Readonly<Record<string, unknown>>;
  readonly syntax: Readonly<Record<string, unknown>>;
  readonly limits: Readonly<Record<string, unknown>>;
}

export interface SqlCapabilityComparison {
  readonly path: string;
  readonly dialects: Readonly<Partial<Record<SqlCapabilityTier1Dialect, SqlCapabilityFeature | null>>>;
  readonly portable: boolean;
  readonly determinate: boolean;
}

export type SqlCompatibilityLevel = 'exact' | 'equivalent' | 'emulated' | 'partial' | 'runtime-dependent' | 'unsupported' | 'not-applicable' | 'source-unavailable' | 'unknown';
export interface SqlCompatibilityReason { readonly code: string; readonly message: string; }
export interface SqlCapabilityCompatibility {
  readonly path: string;
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly source: SqlCapabilityFeature | null;
  readonly target: SqlCapabilityFeature | null;
  readonly compatible: boolean | null;
  readonly level: SqlCompatibilityLevel;
  readonly rewriteRequired: boolean | null;
  readonly lossless: boolean | null;
  readonly reasons: readonly SqlCompatibilityReason[];
}

export interface SqlCategoryComparisonRow {
  readonly path: string;
  readonly dialects: Readonly<Partial<Record<SqlCapabilityTier1Dialect, SqlCapabilityFeature | null>>>;
  readonly universallySupported: boolean;
  readonly determinate: boolean;
}
export interface SqlCategoryComparison {
  readonly category: SqlCapabilityCategory;
  readonly dialects: readonly SqlCapabilityTier1Dialect[];
  readonly paths: readonly string[];
  readonly rows: readonly SqlCategoryComparisonRow[];
}
export interface SqlCapabilityMatrix {
  readonly dialects: readonly SqlCapabilityTier1Dialect[];
  readonly categories: readonly SqlCapabilityCategory[];
  readonly rows: readonly SqlCategoryComparisonRow[];
  readonly summary: Readonly<{ total: number; universallySupported: number; determinate: number; runtimeDependent: number }>;
}

export interface SqlMigrationSurfaceSummary {
  readonly exact: number; readonly equivalent: number; readonly emulated: number; readonly partial: number;
  readonly runtimeDependent: number; readonly unsupported: number; readonly notApplicable: number; readonly unknown: number;
}
export interface SqlMigrationSurface {
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly category: SqlCapabilityCategory | null;
  readonly summary: SqlMigrationSurfaceSummary;
  readonly capabilities: readonly SqlCapabilityCompatibility[];
}
export interface SqlDialectCompatibilityReport {
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly categories: readonly SqlCapabilityCategory[];
  readonly summary: SqlMigrationSurfaceSummary;
  readonly capabilities: readonly SqlCapabilityCompatibility[];
}

export interface SqlCapabilityModelApi {
  readonly schemaVersion: 1;
  readonly tier1Dialects: readonly ['postgresql', 'mysql', 'sqlite'];
  readonly categories: readonly SqlCapabilityCategory[];
  readonly supportLevels: readonly SqlCapabilitySupportLevel[];
  dialect(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg'): SqlDialectCapabilityModel;
  get(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): unknown;
  status(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): SqlCapabilityFeature | null;
  supports(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): boolean;
  compare(path: string, dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]): SqlCapabilityComparison;
  compatibility(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): SqlCapabilityCompatibility;
  paths(category: SqlCapabilityCategory): readonly string[];
  compareCategory(category: SqlCapabilityCategory, dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]): SqlCategoryComparison;
  matrix(options?: { dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]; categories?: readonly SqlCapabilityCategory[] }): SqlCapabilityMatrix;
  migrationSurface(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', category?: SqlCapabilityCategory): SqlMigrationSurface;
  compareDialects(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', options?: { categories?: readonly SqlCapabilityCategory[] }): SqlDialectCompatibilityReport;
}

export const SQL_CAPABILITY_MODEL_SCHEMA_VERSION: 1;
export const TIER1_DIALECTS: readonly ['postgresql', 'mysql', 'sqlite'];
export const SQL_CAPABILITY_CATEGORIES: readonly SqlCapabilityCategory[];
export const SQL_CAPABILITY_SUPPORT_LEVELS: readonly SqlCapabilitySupportLevel[];
export const capabilityModel: SqlCapabilityModelApi;
export type DialectRegistrySurfaceLevel =
  | 'modelled' | 'partial' | 'inherited-unverified' | 'unmodelled' | 'not-applicable';

export type DialectRegistryKind =
  | 'standard' | 'primary-dialect' | 'dialect-profile' | 'dialect'
  | 'procedural-layer' | 'legacy-mode' | 'compatibility-interface'
  | 'compatibility-mode' | 'legacy-product';

export interface DialectRegistryImplementation {
  readonly routable: boolean;
  readonly driver: 'implemented' | 'unimplemented';
  readonly adapter: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | null;
  readonly candidateAdapter: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | null;
  readonly capabilityModel: 'tier1-exhaustive-v1' | 'runtime-descriptor-partial' | 'inherited-unverified' | 'unmodelled';
  readonly compiler: 'implemented' | 'unsupported' | 'inherited-unverified' | 'unmodelled';
}

export interface DialectRegistryLanguageSurfaces {
  readonly capabilities: DialectRegistrySurfaceLevel;
  readonly dataTypes: DialectRegistrySurfaceLevel;
  readonly operators: DialectRegistrySurfaceLevel;
  readonly functions: DialectRegistrySurfaceLevel;
  readonly ddl: DialectRegistrySurfaceLevel;
  readonly dml: DialectRegistrySurfaceLevel;
  readonly dcl: DialectRegistrySurfaceLevel;
  readonly tcl: DialectRegistrySurfaceLevel;
  readonly proceduralLanguage: DialectRegistrySurfaceLevel;
}

export interface DialectRegistryDialect {
  readonly id: string;
  readonly name: string;
  readonly kind: DialectRegistryKind;
  readonly firstClass: boolean;
  readonly parentDialect: string | null;
  readonly primaryDialect: string | null;
  readonly grammarRoot: string | null;
  readonly implementation: DialectRegistryImplementation;
  readonly surfaces: DialectRegistryLanguageSurfaces;
  readonly source: Readonly<{ registryOrdinal: number | null; platformExamples: string }>;
}

export interface DialectRegistryProduct {
  readonly id: string;
  readonly vendor: string;
  readonly product: string;
  readonly dialect: string;
  readonly parentDialect: string | null;
  readonly primaryDialect: string | null;
  readonly versions: Readonly<{ qualified: readonly string[]; policy: 'qualified-runtime-matrix' | 'unqualified' }>;
  readonly driver: DialectRegistryImplementation;
  readonly wireProtocol: Readonly<{
    status: 'qualified' | 'declared' | 'compatibility-unverified' | 'unknown';
    family: string | null;
  }>;
  readonly compatibility: Readonly<{
    grammar: 'inherits-or-specializes' | 'native-or-independent';
    parentDialect: string | null;
    grammarRoot: string | null;
  }>;
  readonly language: DialectRegistryLanguageSurfaces;
  readonly proceduralLanguage: string | null;
  readonly source: Readonly<{
    registryOrdinal: number;
    dialectFamily: string;
    platformExamples: string;
  }>;
}

export interface DialectRegistryResolution {
  readonly id: string;
  readonly product: DialectRegistryProduct | null;
  readonly dialect: DialectRegistryDialect | null;
}

export interface DialectRegistryReport {
  readonly schemaVersion: 1;
  readonly counts: Readonly<{
    masterProfiles: number;
    dialectDefinitions: number;
    firstClassDialects: number;
    routableProducts: number;
  }>;
  readonly primaryDialects: readonly string[];
  readonly dialects: readonly DialectRegistryDialect[];
  readonly products: readonly DialectRegistryProduct[];
}

export interface DialectRegistryValidation {
  readonly valid: boolean;
  readonly schemaVersion: 1;
  readonly masterProfiles: number;
  readonly dialectDefinitions: number;
  readonly firstClassDialects: number;
  readonly errors: readonly string[];
}

export interface DialectRegistryApi {
  readonly SCHEMA_VERSION: 1;
  readonly MASTER_PROFILE_COUNT: 100;
  readonly PRIMARY_DIALECTS: readonly string[];
  readonly SURFACE_KEYS: readonly string[];
  readonly SURFACE_LEVELS: readonly DialectRegistrySurfaceLevel[];
  readonly aliases: Readonly<Record<string, string>>;
  readonly dialects: readonly DialectRegistryDialect[];
  readonly products: readonly DialectRegistryProduct[];
  dialect(id: string): DialectRegistryDialect | null;
  product(id: string): DialectRegistryProduct | null;
  resolve(id: string): DialectRegistryResolution | null;
  ancestry(id: string): readonly DialectRegistryDialect[];
  descendants(id: string): readonly DialectRegistryDialect[];
  productsForDialect(id: string, options?: { includeDescendants?: boolean }): readonly DialectRegistryProduct[];
  report(): DialectRegistryReport;
  validate(): DialectRegistryValidation;
}

export const DIALECT_REGISTRY_SCHEMA_VERSION: 1;
export const DIALECT_REGISTRY_MASTER_PROFILE_COUNT: 100;
export const PRIMARY_SQL_DIALECTS: readonly string[];
export const dialectRegistry: DialectRegistryApi;

import type { DialectRegistryProduct } from './dialect-registry';

/** Catalogue classification is not a claim that a vendor connection adapter exists. */
export type DatabaseModel =
  | 'relational' | 'document' | 'key-value' | 'graph' | 'wide-column'
  | 'search' | 'time-series' | 'vector';
export type DatabaseNativeInterface =
  | 'sql' | 'document-api' | 'command-api' | 'cypher' | 'cql'
  | 'search-api' | 'time-series-api' | 'vector-api' | 'multi-api';
export type DatabaseCandidateOperation =
  | 'sql.query' | 'document.read' | 'key-value.command' | 'graph.query'
  | 'wide-column.query' | 'search.query' | 'time-series.query' | 'vector.search';

export interface DatabaseTechnology {
  readonly id: string;
  readonly vendor: string;
  readonly name: string;
  readonly models: readonly DatabaseModel[];
  /** Descriptors of potential native interfaces, not executable implementations. */
  readonly nativeInterfaces: readonly DatabaseNativeInterface[];
  readonly candidateOperations: readonly DatabaseCandidateOperation[];
  readonly runtime: Readonly<{
    readonly routable: boolean;
    readonly adapter: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | 'redis' | null;
    readonly status: 'implemented' | 'not-implemented';
    readonly qualification: 'tier-1' | 'tier-2' | 'initial' | 'none';
  }>;
  readonly sqlDialect: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | null;
  readonly limitation: string;
}
export interface DatabaseTechnologyInspection {
  readonly schemaVersion: 1;
  readonly technology: DatabaseTechnology;
  readonly canConnect: boolean;
  readonly executableOperations: readonly ('sql.query' | 'key-value.command')[];
  readonly reason: string;
}
export interface DatabaseTechnologyReport {
  readonly schemaVersion: 1;
  readonly counts: Readonly<{ technologies: number; routable: number; unimplemented: number; models: number; relationalSqlProfiles: number }>;
  readonly models: readonly DatabaseModel[];
  readonly nativeInterfaces: readonly DatabaseNativeInterface[];
  readonly technologies: readonly DatabaseTechnology[];
  readonly relationalSqlProfiles: readonly DialectRegistryProduct[];
}
export interface DatabaseTechnologyValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly schemaVersion: 1;
}
export interface DatabaseTechnologyFilters {
  readonly model?: DatabaseModel;
  readonly nativeInterface?: DatabaseNativeInterface;
  readonly routable?: boolean;
}
export interface DatabaseTechnologyRegistry {
  readonly SCHEMA_VERSION: 1;
  readonly MODELS: readonly DatabaseModel[];
  readonly INTERFACES: readonly DatabaseNativeInterface[];
  readonly OPERATIONS: readonly DatabaseCandidateOperation[];
  readonly technologies: readonly DatabaseTechnology[];
  readonly relationalSqlProfiles: readonly DialectRegistryProduct[];
  get(id: string): DatabaseTechnology | null;
  list(options?: DatabaseTechnologyFilters): readonly DatabaseTechnology[];
  inspect(id: string): DatabaseTechnologyInspection | null;
  report(): DatabaseTechnologyReport;
  validate(): DatabaseTechnologyValidation;
}
export const DATABASE_TECHNOLOGY_REGISTRY_SCHEMA_VERSION: 1;
export const databaseTechnologyRegistry: DatabaseTechnologyRegistry;

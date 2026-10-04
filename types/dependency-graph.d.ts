import type * as root from '../index';
import type {
  PortableMetadataSnapshot,
  PortableDatabaseMetadata,
  PortableSchemaMetadata,
  PortableTableMetadata,
  PortableColumnMetadata,
  PortableIndexMetadata,
  PortableForeignKeyMetadata,
  PortableConstraintMetadata
} from './portable-metadata';

export type DatabaseObjectKind =
  | 'database' | 'schema' | 'table' | 'view' | 'foreign-table'
  | 'column' | 'index' | 'foreign-key' | 'constraint';

export interface DatabaseObjectIdentity {
  readonly dialect: string;
  readonly kind: string;
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string | null;
  readonly name: string | null;
}

export interface DatabaseObjectNode {
  readonly id: string;
  readonly kind: DatabaseObjectKind;
  readonly name: string | null;
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string | null;
  readonly metadata:
    | PortableDatabaseMetadata
    | PortableSchemaMetadata
    | PortableTableMetadata
    | PortableColumnMetadata
    | PortableIndexMetadata
    | PortableForeignKeyMetadata
    | PortableConstraintMetadata
    | null;
}

export type DependencyRelation =
  | 'contained-by'
  | 'defined-on'
  | 'uses-column'
  | 'references'
  | 'references-column';

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: DependencyRelation;
  readonly via: string | null;
}

export interface DatabaseDependencyGraph<D extends root.Dialect = root.Dialect> {
  readonly schemaVersion: 1;
  readonly identitySchemaVersion: 1;
  readonly dialect: D;
  readonly nodes: readonly DatabaseObjectNode[];
  readonly edges: readonly DependencyEdge[];
}

export interface DependencyGraphIntrospectionOptions extends root.MetadataScope {
  deep?: boolean;
  concurrency?: number;
  tables?: readonly string[];
}

export interface DependencyTraversalOptions {
  transitive?: boolean;
  relations?: readonly DependencyRelation[];
}

export interface DependencyImpact {
  readonly object: DatabaseObjectNode | null;
  readonly dependencies: readonly DatabaseObjectNode[];
  readonly dependents: readonly DatabaseObjectNode[];
}

export const OBJECT_IDENTITY_SCHEMA_VERSION: 1;
export const DEPENDENCY_GRAPH_SCHEMA_VERSION: 1;

export function objectId(
  kind: DatabaseObjectKind,
  metadata?: Readonly<Record<string, unknown>>,
  context?: Readonly<Record<string, unknown>>
): string;

export function parseObjectId(id: string): DatabaseObjectIdentity;

export function buildDependencyGraph<D extends root.Dialect = root.Dialect>(
  snapshot: PortableMetadataSnapshot<D> | Readonly<{ portable: PortableMetadataSnapshot<D> }>
): DatabaseDependencyGraph<D>;

export function graphDependencies(
  graph: DatabaseDependencyGraph,
  id: string,
  options?: DependencyTraversalOptions
): readonly DatabaseObjectNode[];

export function graphDependents(
  graph: DatabaseDependencyGraph,
  id: string,
  options?: DependencyTraversalOptions
): readonly DatabaseObjectNode[];

export function impactAnalysis(
  graph: DatabaseDependencyGraph,
  id: string,
  options?: DependencyTraversalOptions
): DependencyImpact;

declare module './index' {
  interface MetadataCatalog {
    dependencyGraph(options?: DependencyGraphIntrospectionOptions): Promise<DatabaseDependencyGraph>;
  }

  interface Client {
    dependencyGraph(options?: DependencyGraphIntrospectionOptions): Promise<DatabaseDependencyGraph>;
  }

  function dependencyGraph<D extends root.DialectAlias>(
    dialect: D,
    config?: unknown,
    options?: DependencyGraphIntrospectionOptions
  ): Promise<DatabaseDependencyGraph<root.Dialect>>;

  function dependencyGraph(
    config: root.ClientConfig,
    options?: DependencyGraphIntrospectionOptions
  ): Promise<DatabaseDependencyGraph>;
}

import type * as root from '../index';
import type {
  PortableDatabaseMetadata,
  PortableSchemaMetadata,
  PortableTableMetadata,
  PortableColumnMetadata,
  PortableIndexMetadata,
  PortableForeignKeyMetadata,
  PortableConstraintMetadata,
  PortableMetadataSnapshot
} from './portable-metadata';

export type StructureTreeNodeKind =
  | 'database' | 'schema' | 'table' | 'view' | 'foreign-table'
  | 'column' | 'index' | 'foreign-key' | 'constraint';

export interface StructureTreeNode {
  readonly id: string;
  readonly kind: StructureTreeNodeKind;
  readonly name: string;
  readonly path: readonly (string | null)[];
  readonly metadata:
    | PortableDatabaseMetadata
    | PortableSchemaMetadata
    | PortableTableMetadata
    | PortableColumnMetadata
    | PortableIndexMetadata
    | PortableForeignKeyMetadata
    | PortableConstraintMetadata
    | null;
  readonly children: readonly StructureTreeNode[];
}

export interface StructureTreeSummary {
  readonly databases: number;
  readonly schemas: number;
  readonly tables: number;
  readonly views: number;
  readonly foreignTables: number;
  readonly columns: number;
  readonly indexes: number;
  readonly foreignKeys: number;
  readonly constraints: number;
}

export interface StructureTreeOptions {
  columns?: boolean;
  indexes?: boolean;
  foreignKeys?: boolean;
  constraints?: boolean;
}

export interface StructureTreeBuildOptions extends StructureTreeOptions {}

export interface StructureTreeIntrospectionOptions extends root.MetadataScope {
  deep?: boolean;
  concurrency?: number;
  tables?: readonly string[];
  tree?: StructureTreeOptions;
}

export interface DatabaseStructureTree<D extends root.Dialect = root.Dialect> {
  readonly schemaVersion: 2;
  readonly dialect: D;
  readonly scope: Readonly<root.MetadataScope>;
  readonly summary: StructureTreeSummary;
  readonly databases: readonly StructureTreeNode[];
}

export const STRUCTURE_TREE_SCHEMA_VERSION: 2;

export function buildStructureTree<D extends root.Dialect = root.Dialect>(
  snapshot: PortableMetadataSnapshot<D> | Readonly<{ portable: PortableMetadataSnapshot<D> }>,
  options?: StructureTreeBuildOptions
): DatabaseStructureTree<D>;

declare module './index' {
  interface MetadataCatalog {
    structureTree(options?: StructureTreeIntrospectionOptions): Promise<DatabaseStructureTree>;
  }

  interface Client {
    structureTree(options?: StructureTreeIntrospectionOptions): Promise<DatabaseStructureTree>;
  }

  function structureTree<D extends root.DialectAlias>(
    dialect: D,
    config?: unknown,
    options?: StructureTreeIntrospectionOptions
  ): Promise<DatabaseStructureTree<root.Dialect>>;

  function structureTree(
    config: root.ClientConfig,
    options?: StructureTreeIntrospectionOptions
  ): Promise<DatabaseStructureTree>;
}

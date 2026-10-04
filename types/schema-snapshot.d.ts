import type * as root from '../index';
import type { PortableMetadataSnapshot } from './portable-metadata';
import type { CanonicalTypeDescriptor } from './type-semantics';
import type { DependencyRelation } from './dependency-graph';

export type SchemaSnapshotObjectKind =
  | 'database' | 'schema' | 'table' | 'view' | 'foreign-table'
  | 'column' | 'index' | 'foreign-key' | 'constraint';

export interface SchemaSnapshotObjectBase {
  readonly id: string;
  readonly logicalKey: string;
  readonly kind: SchemaSnapshotObjectKind;
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string | null;
  readonly name: string | null;
}

export interface SchemaSnapshotColumn extends SchemaSnapshotObjectBase {
  readonly kind: 'column';
  readonly ordinal: number | null;
  readonly sourceNativeType: string | null;
  readonly canonicalType: CanonicalTypeDescriptor | null;
  readonly nullability: 'nullable' | 'not-null' | 'unknown';
  readonly default: unknown;
  readonly primaryKey: boolean;
  readonly identity: boolean;
  readonly generated: Readonly<{
    enabled: boolean;
    kind: string | null;
    expression: string | null;
  }>;
}

export interface SchemaSnapshotIndex extends SchemaSnapshotObjectBase {
  readonly kind: 'index';
  readonly unique: boolean;
  readonly primary: boolean;
  readonly method: string | null;
  readonly predicate: string | null;
  readonly keyParts: readonly Readonly<{
    ordinal: number;
    column: string | null;
    expression: string | null;
    descending: boolean;
    collation: string | null;
    included: boolean;
  }>[];
}

export interface SchemaSnapshotForeignKey extends SchemaSnapshotObjectBase {
  readonly kind: 'foreign-key';
  readonly columns: readonly string[];
  readonly referencedDatabase: string | null;
  readonly referencedSchema: string | null;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onUpdate: string | null;
  readonly onDelete: string | null;
  readonly match: string | null;
  readonly deferrable: boolean | null;
  readonly initiallyDeferred: boolean | null;
}

export interface SchemaSnapshotConstraint extends SchemaSnapshotObjectBase {
  readonly kind: 'constraint';
  readonly type: string;
  readonly columns: readonly string[];
  readonly definition: string | null;
  readonly deferrable: boolean | null;
  readonly initiallyDeferred: boolean | null;
}

export interface SchemaSnapshotTable extends SchemaSnapshotObjectBase {
  readonly kind: 'table' | 'view' | 'foreign-table';
  readonly columns: readonly SchemaSnapshotColumn[];
  readonly indexes: readonly SchemaSnapshotIndex[];
  readonly foreignKeys: readonly SchemaSnapshotForeignKey[];
  readonly constraints: readonly SchemaSnapshotConstraint[];
}

export interface SchemaSnapshotDatabase extends SchemaSnapshotObjectBase {
  readonly kind: 'database';
}

export interface SchemaSnapshotSchema extends SchemaSnapshotObjectBase {
  readonly kind: 'schema';
}

export interface SchemaSnapshotDependency {
  readonly from: string;
  readonly to: string;
  readonly relation: DependencyRelation;
  readonly via: string | null;
}

export interface CanonicalSchemaSnapshot<D extends root.Dialect = root.Dialect> {
  readonly schemaVersion: 1;
  readonly sourceDialect: D;
  readonly scope: Readonly<root.MetadataScope>;
  readonly objectIdentitySchemaVersion: 1;
  readonly typeSemanticsSchemaVersion: 1;
  readonly dependencyGraphSchemaVersion: 1;
  readonly semanticHash: string;
  readonly sourceHash: string;
  readonly databases: readonly SchemaSnapshotDatabase[];
  readonly schemas: readonly SchemaSnapshotSchema[];
  readonly tables: readonly SchemaSnapshotTable[];
  readonly dependencies: readonly SchemaSnapshotDependency[];
}

export interface SchemaSnapshotIntrospectionOptions extends root.MetadataScope {
  deep?: boolean;
  concurrency?: number;
  tables?: readonly string[];
}

export const SCHEMA_SNAPSHOT_SCHEMA_VERSION: 1;

export function schemaLogicalKey(kind: SchemaSnapshotObjectKind, parts?: Readonly<{
  database?: string | null;
  schema?: string | null;
  table?: string | null;
  name?: string | null;
}>): string;

export function buildSchemaSnapshot<D extends root.Dialect = root.Dialect>(
  snapshot: PortableMetadataSnapshot<D> | Readonly<{ portable: PortableMetadataSnapshot<D> }>
): CanonicalSchemaSnapshot<D>;

export function schemaFingerprint(snapshot: CanonicalSchemaSnapshot): string;
export function schemasEquivalent(left: CanonicalSchemaSnapshot, right: CanonicalSchemaSnapshot): boolean;
export function sourceSchemasEquivalent(left: CanonicalSchemaSnapshot, right: CanonicalSchemaSnapshot): boolean;

declare module './index' {
  interface MetadataCatalog {
    schemaSnapshot(options?: SchemaSnapshotIntrospectionOptions): Promise<CanonicalSchemaSnapshot>;
  }

  interface Client {
    schemaSnapshot(options?: SchemaSnapshotIntrospectionOptions): Promise<CanonicalSchemaSnapshot>;
  }

  function schemaSnapshot<D extends root.DialectAlias>(
    dialect: D,
    config?: unknown,
    options?: SchemaSnapshotIntrospectionOptions
  ): Promise<CanonicalSchemaSnapshot<root.Dialect>>;

  function schemaSnapshot(
    config: root.ClientConfig,
    options?: SchemaSnapshotIntrospectionOptions
  ): Promise<CanonicalSchemaSnapshot>;
}

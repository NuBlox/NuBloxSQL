import type * as root from '../index';

export type PortableMetadataDialect = 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver';
export type PortableMetadataObjectKind = 'database' | 'schema' | 'table' | 'view' | 'foreign-table' | 'column' | 'index' | 'foreign-key' | 'constraint';
export type PortableNullability = 'nullable' | 'not-null' | 'unknown';

export interface PortableGeneratedColumnMetadata {
  readonly enabled: boolean;
  readonly kind: string | null;
  readonly expression: string | null;
}

export interface PortableDatabaseMetadata {
  readonly kind: 'database';
  readonly name: string;
  readonly native: unknown;
}

export interface PortableSchemaMetadata {
  readonly kind: 'schema';
  readonly database: string | null;
  readonly name: string;
  readonly native: unknown;
}

export interface PortableColumnMetadata {
  readonly kind: 'column';
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string;
  readonly name: string;
  readonly ordinal: number | null;
  readonly dataType: string | null;
  readonly nativeType: string | null;
  readonly nullability: PortableNullability;
  readonly default: unknown;
  readonly primaryKey: boolean;
  readonly identity: boolean;
  readonly generated: PortableGeneratedColumnMetadata;
  readonly native: unknown;
}

export interface PortableIndexKeyPart {
  readonly ordinal: number;
  readonly column: string | null;
  readonly expression: string | null;
  readonly descending: boolean;
  readonly collation: string | null;
  readonly included: boolean;
}

export interface PortableIndexMetadata {
  readonly kind: 'index';
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly primary: boolean;
  readonly method: string | null;
  readonly predicate: string | null;
  readonly keyParts: readonly PortableIndexKeyPart[];
  readonly native: unknown;
}

export interface PortableForeignKeyMetadata {
  readonly kind: 'foreign-key';
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string;
  readonly name: string | null;
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
  readonly native: unknown;
}

export interface PortableConstraintMetadata {
  readonly kind: 'constraint';
  readonly database: string | null;
  readonly schema: string | null;
  readonly table: string;
  readonly name: string | null;
  readonly type: string;
  readonly columns: readonly string[];
  readonly definition: string | null;
  readonly deferrable: boolean | null;
  readonly initiallyDeferred: boolean | null;
  readonly native: unknown;
}

export interface PortableTableMetadata {
  readonly kind: 'table' | 'view' | 'foreign-table';
  readonly database: string | null;
  readonly schema: string | null;
  readonly name: string;
  readonly columns: readonly PortableColumnMetadata[];
  readonly indexes: readonly PortableIndexMetadata[];
  readonly foreignKeys: readonly PortableForeignKeyMetadata[];
  readonly constraints: readonly PortableConstraintMetadata[];
  readonly native: unknown;
}

export interface PortableMetadataSnapshot<D extends PortableMetadataDialect = PortableMetadataDialect> {
  readonly vocabularyVersion: 1;
  readonly dialect: D;
  readonly scope: Readonly<root.MetadataScope>;
  readonly databases: readonly PortableDatabaseMetadata[];
  readonly schemas: readonly PortableSchemaMetadata[];
  readonly tables: readonly PortableTableMetadata[];
}

declare module './index' {
  interface MetadataSnapshot<D extends root.Dialect = root.Dialect> {
    readonly portable: PortableMetadataSnapshot<D>;
  }
}

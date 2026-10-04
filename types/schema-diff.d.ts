import type { CanonicalSchemaSnapshot } from './schema-snapshot';
import type { PortableMetadataSnapshot } from './portable-metadata';

export type SchemaDiffStatus = 'added' | 'removed' | 'modified';
export type SchemaChangeSafety =
  | 'safe'
  | 'dependency-sensitive'
  | 'manual-review'
  | 'potentially-lossy'
  | 'destructive';

export interface SchemaPropertyDelta {
  readonly property: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface SchemaDiffDependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly via: string | null;
}

export interface SchemaObjectChange {
  readonly status: SchemaDiffStatus;
  readonly safety: SchemaChangeSafety;
  readonly logicalKey: string;
  readonly kind: string;
  readonly before: unknown | null;
  readonly after: unknown | null;
  readonly deltas: readonly SchemaPropertyDelta[];
  readonly dependencies: readonly SchemaDiffDependencyEdge[];
}

export interface SchemaDiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
  readonly unchanged: number;
  readonly safe: number;
  readonly 'dependency-sensitive': number;
  readonly 'manual-review': number;
  readonly 'potentially-lossy': number;
  readonly destructive: number;
}

export interface SchemaDependencyChanges {
  readonly added: readonly SchemaDiffDependencyEdge[];
  readonly removed: readonly SchemaDiffDependencyEdge[];
}

export interface SchemaDiff {
  readonly schemaVersion: 1;
  readonly left: Readonly<{ semanticHash: string; sourceHash: string; dialect: string }>;
  readonly right: Readonly<{ semanticHash: string; sourceHash: string; dialect: string }>;
  readonly equivalent: boolean;
  readonly summary: SchemaDiffSummary;
  readonly changes: readonly SchemaObjectChange[];
  readonly dependencyChanges: SchemaDependencyChanges;
}

export type SchemaDiffInput =
  | CanonicalSchemaSnapshot
  | PortableMetadataSnapshot
  | Readonly<{ portable: PortableMetadataSnapshot }>;

export const SCHEMA_DIFF_SCHEMA_VERSION: 1;
export const SCHEMA_CHANGE_SAFETY: readonly SchemaChangeSafety[];

export function diffSchemas(left: SchemaDiffInput, right: SchemaDiffInput): SchemaDiff;
export function schemaDiffChanged(diff: SchemaDiff): boolean;
export function schemaDiffHighestSafety(diff: SchemaDiff): SchemaChangeSafety;

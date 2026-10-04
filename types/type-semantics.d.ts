import type * as root from '../index';
import type { PortableMetadataSnapshot } from './portable-metadata';

export type CanonicalTypeFamily =
  | 'boolean'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'decimal'
  | 'float32'
  | 'float64'
  | 'text'
  | 'binary'
  | 'uuid'
  | 'json'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'array'
  | 'native';

export type TypeMappingDecision =
  | 'native-equivalent'
  | 'lossless-map'
  | 'lossy-map'
  | 'application-convention'
  | 'unsupported'
  | 'runtime-qualified';

export interface CanonicalTypeDescriptor {
  readonly family: CanonicalTypeFamily;
  readonly precision: number | null;
  readonly scale: number | null;
  readonly length: number | null;
  readonly timezone: boolean;
  readonly unsigned: boolean;
  readonly native: string | null;
}

export interface TypeMappingResult {
  readonly decision: TypeMappingDecision;
  readonly nativeType: string | null;
  readonly lossless: boolean | null;
  readonly reason: string;
}

export interface TypeCompatibilityResult {
  readonly canonical: CanonicalTypeDescriptor | null;
  readonly target: TypeMappingResult;
}

export interface CanonicalColumnTypeAnnotation {
  readonly name: string;
  readonly nativeType: string | null;
  readonly canonical: CanonicalTypeDescriptor | null;
}

export interface CanonicalTableTypeAnnotation {
  readonly database: string | null;
  readonly schema: string | null;
  readonly name: string;
  readonly columns: readonly CanonicalColumnTypeAnnotation[];
}

export interface CanonicalTypeAnnotation<D extends root.Dialect = root.Dialect> {
  readonly dialect: D;
  readonly tables: readonly CanonicalTableTypeAnnotation[];
}

export interface TypeSemanticsApi {
  readonly SCHEMA_VERSION: 1;
  readonly DECISIONS: readonly TypeMappingDecision[];
  canonical(family: CanonicalTypeFamily, options?: Partial<Omit<CanonicalTypeDescriptor, 'family'>>): CanonicalTypeDescriptor;
  infer(
    dialect: root.DialectAlias,
    nativeType: string | null | undefined,
    metadata?: Readonly<Record<string, unknown>>
  ): CanonicalTypeDescriptor | null;
  target(dialect: root.DialectAlias, spec: CanonicalTypeDescriptor): TypeMappingResult;
  compatibility(
    fromDialect: root.DialectAlias,
    toDialect: root.DialectAlias,
    nativeType: string | null | undefined,
    metadata?: Readonly<Record<string, unknown>>
  ): TypeCompatibilityResult;
  annotate<D extends root.Dialect = root.Dialect>(
    snapshot: PortableMetadataSnapshot<D> | Readonly<{ portable: PortableMetadataSnapshot<D> }>
  ): CanonicalTypeAnnotation<D>;
}

export const TYPE_SEMANTICS_SCHEMA_VERSION: 1;
export const TYPE_MAPPING_DECISIONS: readonly TypeMappingDecision[];
export const typeSemantics: TypeSemanticsApi;
export function canonicalType(
  dialect: root.DialectAlias,
  nativeType: string | null | undefined,
  metadata?: Readonly<Record<string, unknown>>
): CanonicalTypeDescriptor | null;
export function nativeTypeMapping(dialect: root.DialectAlias, spec: CanonicalTypeDescriptor): TypeMappingResult;
export function typeCompatibility(
  fromDialect: root.DialectAlias,
  toDialect: root.DialectAlias,
  nativeType: string | null | undefined,
  metadata?: Readonly<Record<string, unknown>>
): TypeCompatibilityResult;
export function annotateTypes<D extends root.Dialect = root.Dialect>(
  snapshot: PortableMetadataSnapshot<D> | Readonly<{ portable: PortableMetadataSnapshot<D> }>
): CanonicalTypeAnnotation<D>;

import type * as root from '../index';

export interface PostgreSqlDeepMetadataScope extends root.MetadataScope {}

export interface PostgreSqlTableDetails {
  readonly database: string | null;
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly persistence: string | null;
  readonly owner: string | null;
  readonly tablespace: string | null;
  readonly rowSecurity: boolean;
  readonly forceRowSecurity: boolean;
  readonly partition: boolean;
  readonly partitionKey: string | null;
  readonly partitionBound: string | null;
  readonly replicaIdentity: string | null;
  readonly estimatedRows: number | null;
  readonly pages: number | null;
  readonly comment: string | null;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlColumnDetails {
  readonly database: string | null; readonly schema: string; readonly table: string; readonly name: string;
  readonly ordinal: number; readonly formattedType: string; readonly typeSchema: string; readonly nativeType: string;
  readonly nullable: boolean; readonly identity: 'always' | 'by-default' | null;
  readonly generated: 'stored' | 'virtual' | null; readonly expression: string | null; readonly sequence: string | null;
  readonly collation: string | null; readonly storage: string | null; readonly compression: string | null;
  readonly statisticsTarget: number | null; readonly comment: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlIndexDetails {
  readonly database: string | null; readonly schema: string; readonly table: string; readonly name: string;
  readonly method: string | null; readonly unique: boolean; readonly primary: boolean; readonly exclusion: boolean;
  readonly immediate: boolean; readonly clustered: boolean; readonly valid: boolean; readonly ready: boolean;
  readonly live: boolean; readonly replicaIdentity: boolean; readonly nullsNotDistinct: boolean;
  readonly keyAttributeCount: number; readonly totalAttributeCount: number; readonly predicate: string | null;
  readonly expressions: string | null; readonly definition: string | null; readonly tablespace: string | null;
  readonly comment: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlConstraintDetails {
  readonly database: string | null; readonly schema: string; readonly table: string; readonly name: string;
  readonly type: string; readonly deferrable: boolean; readonly initiallyDeferred: boolean; readonly validated: boolean;
  readonly noInherit: boolean; readonly inherited: boolean; readonly definition: string | null;
  readonly referencedSchema: string | null; readonly referencedTable: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlPartitionDetails {
  readonly database: string | null; readonly parentSchema: string; readonly parent: string; readonly schema: string;
  readonly name: string; readonly key: string | null; readonly bound: string | null; readonly persistence: string | null;
  readonly estimatedRows: number | null; readonly pages: number | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlPolicyDetails {
  readonly database: string | null; readonly schema: string; readonly table: string; readonly name: string;
  readonly command: string; readonly permissive: boolean; readonly roles: readonly string[];
  readonly using: string | null; readonly check: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlRoutineDetails {
  readonly database: string | null; readonly schema: string; readonly name: string; readonly kind: string;
  readonly language: string; readonly owner: string | null; readonly identityArguments: string; readonly arguments: string;
  readonly resultType: string | null; readonly volatility: string; readonly strict: boolean; readonly securityDefiner: boolean;
  readonly leakproof: boolean; readonly parallelSafety: string; readonly cost: number | null;
  readonly estimatedRows: number | null; readonly configuration: readonly string[]; readonly definition: string | null;
  readonly comment: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlEnumValue { readonly label: string; readonly order: number; }
export interface PostgreSqlDomainConstraint { readonly name: string; readonly definition: string | null; readonly validated: boolean; }
export interface PostgreSqlTypeDetails {
  readonly database: string | null; readonly schema: string; readonly name: string; readonly kind: string;
  readonly category: string | null; readonly preferred: boolean; readonly nullable: boolean; readonly default: string | null;
  readonly delimiter: string | null; readonly baseType: string | null; readonly elementType: string | null;
  readonly collation: string | null; readonly rangeSubtype: string | null; readonly multirangeType: string | null;
  readonly enumValues: readonly PostgreSqlEnumValue[]; readonly domainConstraints: readonly PostgreSqlDomainConstraint[];
  readonly comment: string | null; readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlSequenceDetails {
  readonly database: string | null; readonly schema: string; readonly name: string; readonly owner: string | null;
  readonly dataType: string | null; readonly start: unknown; readonly min: unknown; readonly max: unknown;
  readonly increment: unknown; readonly cycle: boolean; readonly cache: unknown; readonly lastValue: unknown;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlPrivilegeDetails {
  readonly database: string | null; readonly schema: string | null; readonly objectKind: string; readonly object: string;
  readonly grantor: string | null; readonly grantee: string; readonly privilege: string; readonly grantable: boolean;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface PostgreSqlDeepCatalog {
  readonly dialect: 'postgresql';
  readonly partitions: readonly PostgreSqlPartitionDetails[];
  readonly policies: readonly PostgreSqlPolicyDetails[];
  readonly routines: readonly PostgreSqlRoutineDetails[];
  readonly types: readonly PostgreSqlTypeDetails[];
  readonly sequences: readonly PostgreSqlSequenceDetails[];
  readonly privileges: readonly PostgreSqlPrivilegeDetails[];
}

declare module '../index' {
  interface MetadataCatalog {
    tableDetails(name: string, options?: PostgreSqlDeepMetadataScope): Promise<PostgreSqlTableDetails | null>;
    columnDetails(table: string, options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlColumnDetails[]>;
    indexDetails(table: string, options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlIndexDetails[]>;
    constraintDetails(table: string, options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlConstraintDetails[]>;
    partitions(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlPartitionDetails[]>;
    policies(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlPolicyDetails[]>;
    routines(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlRoutineDetails[]>;
    types(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlTypeDetails[]>;
    sequences(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlSequenceDetails[]>;
    privileges(options?: PostgreSqlDeepMetadataScope): Promise<readonly PostgreSqlPrivilegeDetails[]>;
    deepCatalog(options?: PostgreSqlDeepMetadataScope): Promise<PostgreSqlDeepCatalog>;
  }
}

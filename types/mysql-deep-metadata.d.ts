export interface MySqlDeepMetadataScope {
  database?: string;
  schema?: string;
  includeSystem?: boolean;
}

export interface MySqlNativeMetadata { readonly native: Readonly<Record<string, unknown>>; }

export interface MySqlTableDetails extends MySqlNativeMetadata {
  readonly database: string; readonly schema: string; readonly name: string; readonly kind: string;
  readonly engine: string | null; readonly engineVersion: number | null; readonly rowFormat: string | null;
  readonly estimatedRows: number | null; readonly dataLength: number | null; readonly indexLength: number | null;
  readonly autoIncrement: unknown; readonly collation: string | null; readonly createOptions: string | null;
  readonly comment: string | null;
}
export interface MySqlColumnDetails extends MySqlNativeMetadata {
  readonly database: string; readonly schema: string; readonly table: string; readonly name: string; readonly ordinal: number;
  readonly dataType: string; readonly nativeType: string; readonly nullable: boolean; readonly default: unknown;
  readonly primaryKey: boolean; readonly uniqueKey: boolean; readonly indexed: boolean; readonly identity: boolean;
  readonly generated: boolean; readonly generatedKind: 'virtual' | 'stored' | null; readonly generationExpression: string | null;
  readonly characterSet: string | null; readonly collation: string | null; readonly privileges: readonly string[];
  readonly comment: string | null;
}
export interface MySqlIndexColumn { readonly ordinal: number; readonly name: string | null; readonly expression: string | null; readonly prefixLength: number | null; }
export interface MySqlIndexDetails {
  readonly database: string; readonly schema: string; readonly table: string; readonly name: string;
  readonly unique: boolean; readonly primary: boolean; readonly type: string | null; readonly visible: boolean;
  readonly comment: string | null; readonly columns: readonly MySqlIndexColumn[]; readonly native: readonly Readonly<Record<string, unknown>>[];
}
export interface MySqlConstraintDetails extends MySqlNativeMetadata {
  readonly database: string; readonly schema: string; readonly table: string; readonly name: string; readonly type: string;
  readonly enforced: boolean; readonly referencedSchema: string | null; readonly referencedTable: string | null;
  readonly updateRule: string | null; readonly deleteRule: string | null; readonly check: string | null;
}
export interface MySqlPartitionDetails extends MySqlNativeMetadata { readonly schema: string; readonly table: string; readonly name: string; readonly method: string | null; readonly expression: string | null; }
export interface MySqlRoutineDetails extends MySqlNativeMetadata { readonly schema: string; readonly name: string; readonly kind: string; readonly definition: string | null; readonly definer: string | null; }
export interface MySqlTriggerDetails extends MySqlNativeMetadata { readonly schema: string; readonly name: string; readonly table: string; readonly event: string; readonly timing: string; readonly statement: string | null; }
export interface MySqlEventDetails extends MySqlNativeMetadata { readonly schema: string; readonly name: string; readonly status: string | null; readonly definition: string | null; }
export interface MySqlPrivilegeDetails extends MySqlNativeMetadata { readonly schema: string | null; readonly objectKind: string; readonly object: string | null; readonly grantee: string; readonly privilege: string; readonly grantable: boolean; }
export interface MySqlDeepCatalog {
  readonly dialect: 'mysql'; readonly partitions: readonly MySqlPartitionDetails[]; readonly routines: readonly MySqlRoutineDetails[];
  readonly triggers: readonly MySqlTriggerDetails[]; readonly events: readonly MySqlEventDetails[]; readonly privileges: readonly MySqlPrivilegeDetails[];
}

declare module '../index' {
  interface MetadataCatalog {
    tableDetails(name: string, options?: MySqlDeepMetadataScope): Promise<MySqlTableDetails | null>;
    columnDetails(table: string, options?: MySqlDeepMetadataScope): Promise<readonly MySqlColumnDetails[]>;
    indexDetails(table: string, options?: MySqlDeepMetadataScope): Promise<readonly MySqlIndexDetails[]>;
    constraintDetails(table: string, options?: MySqlDeepMetadataScope): Promise<readonly MySqlConstraintDetails[]>;
    partitions(options?: MySqlDeepMetadataScope): Promise<readonly MySqlPartitionDetails[]>;
    routines(options?: MySqlDeepMetadataScope): Promise<readonly MySqlRoutineDetails[]>;
    triggers(options?: MySqlDeepMetadataScope): Promise<readonly MySqlTriggerDetails[]>;
    events(options?: MySqlDeepMetadataScope): Promise<readonly MySqlEventDetails[]>;
    privileges(options?: MySqlDeepMetadataScope): Promise<readonly MySqlPrivilegeDetails[]>;
    deepCatalog(options?: MySqlDeepMetadataScope): Promise<MySqlDeepCatalog | Readonly<Record<string, unknown>>>;
  }
}

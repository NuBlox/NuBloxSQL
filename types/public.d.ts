export * from './index';

export type SqlCapabilityTier1Dialect = 'postgresql' | 'mysql' | 'sqlite';
export type SqlCapabilitySupportLevel =
  | 'native' | 'equivalent' | 'emulated' | 'partial' | 'runtime-dependent'
  | 'unsupported' | 'unknown' | 'not-applicable';
export type SqlCapabilityCoverageLevel = 'foundation' | 'exhaustive-v1';
export type SqlCapabilityCategory =
  | 'statements' | 'queries' | 'schema' | 'expressions' | 'integrity' | 'physical'
  | 'security' | 'transactions' | 'programmability' | 'administration' | 'dataMovement'
  | 'extensions' | 'types' | 'functions' | 'operators' | 'keywords' | 'syntax' | 'limits';

export interface SqlCapabilityFeature {
  readonly supported: boolean | null; readonly support: SqlCapabilitySupportLevel;
  readonly nativeName: string | null; readonly since: string | null; readonly deprecatedSince: string | null;
  readonly syntax: string | null; readonly standard: string | null; readonly evidence: string;
  readonly references: readonly string[]; readonly restrictions: readonly string[]; readonly aliases: readonly string[];
  readonly equivalentTo: readonly string[]; readonly notes: string | null;
}

export interface SqlDialectCapabilityModel {
  readonly schemaVersion: 1; readonly dialect: SqlCapabilityTier1Dialect; readonly tier: 1; readonly coverage: SqlCapabilityCoverageLevel;
  readonly identity: Readonly<{ family: string; name: string; referenceVersion: string; versionPolicy: string }>;
  readonly categories: readonly SqlCapabilityCategory[]; readonly evidenceRegister: readonly string[];
  readonly statements: Readonly<Record<string, unknown>>; readonly queries: Readonly<Record<string, unknown>>;
  readonly schema: Readonly<Record<string, unknown>>; readonly expressions: Readonly<Record<string, unknown>>;
  readonly integrity: Readonly<Record<string, unknown>>; readonly physical: Readonly<Record<string, unknown>>;
  readonly security: Readonly<Record<string, unknown>>; readonly transactions: Readonly<Record<string, unknown>>;
  readonly programmability: Readonly<Record<string, unknown>>; readonly administration: Readonly<Record<string, unknown>>;
  readonly dataMovement: Readonly<Record<string, unknown>>; readonly extensions: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, unknown>>; readonly functions: Readonly<Record<string, unknown>>;
  readonly operators: Readonly<Record<string, unknown>>; readonly keywords: Readonly<Record<string, unknown>>;
  readonly syntax: Readonly<Record<string, unknown>>; readonly limits: Readonly<Record<string, unknown>>;
}

export interface SqlCapabilityComparison {
  readonly path: string; readonly dialects: Readonly<Partial<Record<SqlCapabilityTier1Dialect, SqlCapabilityFeature | null>>>;
  readonly portable: boolean; readonly determinate: boolean;
}

export type SqlCompatibilityLevel = 'exact' | 'equivalent' | 'emulated' | 'partial' | 'runtime-dependent' | 'unsupported' | 'not-applicable' | 'source-unavailable' | 'unknown';
export interface SqlCompatibilityReason { readonly code: string; readonly message: string; }
export interface SqlCapabilityCompatibility {
  readonly path: string; readonly from: SqlCapabilityTier1Dialect; readonly to: SqlCapabilityTier1Dialect;
  readonly source: SqlCapabilityFeature | null; readonly target: SqlCapabilityFeature | null;
  readonly compatible: boolean | null; readonly level: SqlCompatibilityLevel; readonly rewriteRequired: boolean | null;
  readonly lossless: boolean | null; readonly reasons: readonly SqlCompatibilityReason[];
}

export interface SqlCategoryComparisonRow {
  readonly path: string; readonly dialects: Readonly<Partial<Record<SqlCapabilityTier1Dialect, SqlCapabilityFeature | null>>>;
  readonly universallySupported: boolean; readonly determinate: boolean;
}
export interface SqlCategoryComparison {
  readonly category: SqlCapabilityCategory; readonly dialects: readonly SqlCapabilityTier1Dialect[];
  readonly paths: readonly string[]; readonly rows: readonly SqlCategoryComparisonRow[];
}
export interface SqlCapabilityMatrix {
  readonly dialects: readonly SqlCapabilityTier1Dialect[]; readonly categories: readonly SqlCapabilityCategory[];
  readonly rows: readonly SqlCategoryComparisonRow[];
  readonly summary: Readonly<{ total: number; universallySupported: number; determinate: number; runtimeDependent: number }>;
}

export interface SqlMigrationSurfaceSummary {
  readonly exact: number; readonly equivalent: number; readonly emulated: number; readonly partial: number;
  readonly runtimeDependent: number; readonly unsupported: number; readonly notApplicable: number; readonly unknown: number;
}
export interface SqlMigrationSurface {
  readonly from: SqlCapabilityTier1Dialect; readonly to: SqlCapabilityTier1Dialect; readonly category: SqlCapabilityCategory | null;
  readonly summary: SqlMigrationSurfaceSummary; readonly capabilities: readonly SqlCapabilityCompatibility[];
}
export interface SqlDialectCompatibilityReport {
  readonly from: SqlCapabilityTier1Dialect; readonly to: SqlCapabilityTier1Dialect; readonly categories: readonly SqlCapabilityCategory[];
  readonly summary: SqlMigrationSurfaceSummary; readonly capabilities: readonly SqlCapabilityCompatibility[];
}

export interface SqlRuntimeCapabilityEvidence {
  readonly version?: string;
  readonly features?: Readonly<Record<string, boolean>>;
  readonly source?: string;
  readonly generatedAt?: string | null;
}
export interface SqlRuntimeCapabilityEntry {
  readonly path: string; readonly static: SqlCapabilityFeature; readonly supported: boolean | null;
  readonly support: SqlCapabilitySupportLevel; readonly resolved: boolean;
  readonly resolution: string; readonly runtimeVersion: string | null; readonly evidence: unknown; readonly reason: string | null;
}
export interface SqlRuntimeCapabilityReport {
  readonly dialect: SqlCapabilityTier1Dialect; readonly version: string | null; readonly source: string; readonly generatedAt: string | null;
  readonly summary: Readonly<{ total: number; resolved: number; unresolved: number; supported: number; unsupported: number; runtimeQualified: number }>;
  readonly entries: readonly SqlRuntimeCapabilityEntry[];
}
export interface SqlRuntimeQualifiableClient {
  readonly dialect: SqlCapabilityTier1Dialect;
  readonly native: unknown;
  one<Row = Record<string, unknown>>(statement: string): Promise<Row>;
}

export type SqlRewriteAction = 'preserve' | 'rewrite' | 'emulate' | 'qualify' | 'reject';
export interface SqlRewritePlanOptions {
  readonly sourceQualification?: SqlRuntimeCapabilityReport;
  readonly targetQualification?: SqlRuntimeCapabilityReport;
}
export interface SqlRewriteDecision {
  readonly path: string;
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly action: SqlRewriteAction;
  readonly level: SqlCompatibilityLevel;
  readonly lossless: boolean | null;
  readonly reason: string;
  readonly source: SqlCapabilityFeature | null;
  readonly target: SqlCapabilityFeature | null;
  readonly sourceResolution: string;
  readonly targetResolution: string;
}
export interface SqlRewritePlan {
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly decisions: readonly SqlRewriteDecision[];
  readonly summary: Readonly<{ preserve: number; rewrite: number; emulate: number; qualify: number; reject: number }>;
  readonly blocked: boolean;
  readonly requiresQualification: boolean;
  readonly requiresTransformation: boolean;
  readonly safeToProceed: boolean;
}
export interface SqlRewriteSqlOptions extends SqlRewritePlanOptions {
  readonly capabilities?: readonly string[];
  readonly allowBlocked?: boolean;
  readonly allowUnqualified?: boolean;
}
export interface SqlRewriteRuleApplication {
  readonly id: string;
  readonly lossless: boolean;
}
export interface SqlRewriteResult {
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly input: string;
  readonly sql: string;
  readonly changed: boolean;
  readonly lossless: boolean;
  readonly rules: readonly SqlRewriteRuleApplication[];
  readonly parameters: Readonly<{
    sourceStyle: string;
    targetStyle: string;
    targetToSource: readonly (number | string)[];
  }>;
  readonly plan: SqlRewritePlan | null;
}

export interface SqlAstIdentifier { readonly type: 'Identifier'; readonly parts: readonly string[]; }
export interface SqlAstLiteral { readonly type: 'Literal'; readonly value: string | number | boolean | null; readonly raw: string | null; }
export interface SqlAstParameter { readonly type: 'Parameter'; readonly binding: number | string; readonly style: string | null; }
export interface SqlAstWildcard { readonly type: 'Wildcard'; readonly qualifier: SqlAstIdentifier | null; }
export interface SqlAstCallExpression { readonly type: 'CallExpression'; readonly name: SqlAstIdentifier; readonly arguments: readonly SqlAstExpression[]; }
export interface SqlAstUnaryExpression { readonly type: 'UnaryExpression'; readonly operator: string; readonly argument: SqlAstExpression; }
export interface SqlAstBinaryExpression { readonly type: 'BinaryExpression'; readonly operator: string; readonly left: SqlAstExpression; readonly right: SqlAstExpression; }
export interface SqlAstListExpression { readonly type: 'ListExpression'; readonly items: readonly SqlAstExpression[]; }
export interface SqlAstAliasedExpression { readonly type: 'AliasedExpression'; readonly expression: SqlAstExpression; readonly alias: SqlAstIdentifier; }
export interface SqlAstSubqueryExpression { readonly type: 'SubqueryExpression'; readonly query: SqlQueryAst; }
export interface SqlAstExistsExpression { readonly type: 'ExistsExpression'; readonly query: SqlQueryAst; }
export type SqlAstExpression = SqlAstIdentifier | SqlAstLiteral | SqlAstParameter | SqlAstWildcard | SqlAstCallExpression | SqlAstUnaryExpression | SqlAstBinaryExpression | SqlAstListExpression | SqlAstAliasedExpression | SqlAstSubqueryExpression | SqlAstExistsExpression;
export interface SqlAstTableReference { readonly type: 'TableReference'; readonly name: SqlAstIdentifier; readonly alias: SqlAstIdentifier | null; }
export interface SqlAstDerivedTable { readonly type: 'DerivedTable'; readonly query: SqlQueryAst; readonly alias: SqlAstIdentifier; readonly columns: readonly SqlAstIdentifier[]; }
export type SqlAstRelation = SqlAstTableReference | SqlAstDerivedTable;
export interface SqlAstJoin { readonly type: 'Join'; readonly kind: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS'; readonly source: SqlAstRelation; readonly condition: SqlAstExpression | null; }
export interface SqlAstOrderExpression { readonly type: 'OrderExpression'; readonly expression: SqlAstExpression; readonly direction: 'ASC' | 'DESC' | null; }
export interface SqlAstCommonTableExpression { readonly type: 'CommonTableExpression'; readonly name: SqlAstIdentifier; readonly columns: readonly SqlAstIdentifier[]; readonly query: SqlQueryAst; }
export interface SqlAstWithClause { readonly type: 'WithClause'; readonly recursive: boolean; readonly entries: readonly SqlAstCommonTableExpression[]; }
export interface SqlSelectStatementAst {
  readonly type: 'SelectStatement'; readonly with: SqlAstWithClause | null; readonly distinct: boolean; readonly columns: readonly SqlAstExpression[];
  readonly from: SqlAstRelation | null; readonly joins: readonly SqlAstJoin[]; readonly where: SqlAstExpression | null;
  readonly groupBy: readonly SqlAstExpression[]; readonly having: SqlAstExpression | null;
  readonly orderBy: readonly SqlAstOrderExpression[]; readonly limit: SqlAstExpression | null; readonly offset: SqlAstExpression | null;
}
export type SqlSetOperator = 'UNION' | 'INTERSECT' | 'EXCEPT';
export interface SqlSetOperationStatementAst {
  readonly type: 'SetOperationStatement'; readonly with: SqlAstWithClause | null;
  readonly left: SqlQueryAst; readonly operator: SqlSetOperator; readonly all: boolean; readonly right: SqlQueryAst;
  readonly orderBy: readonly SqlAstOrderExpression[]; readonly limit: SqlAstExpression | null; readonly offset: SqlAstExpression | null;
}
export type SqlQueryAst = SqlSelectStatementAst | SqlSetOperationStatementAst;
export type SqlCompilerScope = 'select-foundation-v1' | 'select-query-v2' | 'select-query-v3';
export interface SqlAstAnalysis { readonly statementType: 'SelectStatement' | 'SetOperationStatement'; readonly scope: SqlCompilerScope; readonly capabilities: readonly string[]; }
export interface SqlCompiledAst { readonly dialect: SqlCapabilityTier1Dialect; readonly sql: string; readonly targetToSource: readonly (number | string)[]; }
export interface SqlTranspileOptions extends SqlRewritePlanOptions {
  readonly allowBlocked?: boolean; readonly allowUnqualified?: boolean; readonly allowEmulation?: boolean;
}
export interface SqlTranspileResult {
  readonly from: SqlCapabilityTier1Dialect; readonly to: SqlCapabilityTier1Dialect; readonly scope: SqlCompilerScope;
  readonly ast: SqlQueryAst; readonly capabilities: readonly string[]; readonly plan: SqlRewritePlan;
  readonly sql: string; readonly targetToSource: readonly (number | string)[]; readonly lossless: boolean; readonly certified: boolean;
}

export interface SqlCapabilityModelApi {
  readonly schemaVersion: 1; readonly tier1Dialects: readonly ['postgresql', 'mysql', 'sqlite'];
  readonly categories: readonly SqlCapabilityCategory[]; readonly supportLevels: readonly SqlCapabilitySupportLevel[];
  dialect(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg'): SqlDialectCapabilityModel;
  get(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): unknown;
  status(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): SqlCapabilityFeature | null;
  supports(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): boolean;
  compare(path: string, dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]): SqlCapabilityComparison;
  compatibility(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string): SqlCapabilityCompatibility;
  paths(category: SqlCapabilityCategory): readonly string[];
  compareCategory(category: SqlCapabilityCategory, dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]): SqlCategoryComparison;
  matrix(options?: { dialects?: readonly (SqlCapabilityTier1Dialect | 'postgres' | 'pg')[]; categories?: readonly SqlCapabilityCategory[] }): SqlCapabilityMatrix;
  migrationSurface(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', category?: SqlCapabilityCategory): SqlMigrationSurface;
  compareDialects(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', options?: { categories?: readonly SqlCapabilityCategory[] }): SqlDialectCompatibilityReport;
  qualify(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', evidence?: SqlRuntimeCapabilityEvidence): SqlRuntimeCapabilityReport;
  qualifyClient(client: SqlRuntimeQualifiableClient): Promise<SqlRuntimeCapabilityReport>;
  compareVersion(left: string, right: string): -1 | 0 | 1 | null;
  rewriteDecision(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', path: string, options?: SqlRewritePlanOptions): SqlRewriteDecision;
  planRewrite(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', paths: readonly string[], options?: SqlRewritePlanOptions): SqlRewritePlan;
  rewriteSql(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', sql: string, options?: SqlRewriteSqlOptions): SqlRewriteResult;
  parseSql(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', sql: string): SqlQueryAst;
  analyzeAst(ast: SqlQueryAst): SqlAstAnalysis;
  compileAst(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', ast: SqlQueryAst): SqlCompiledAst;
  transpileSql(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', sql: string, options?: SqlTranspileOptions): SqlTranspileResult;
}

export const SQL_CAPABILITY_MODEL_SCHEMA_VERSION: 1;
export const TIER1_DIALECTS: readonly ['postgresql', 'mysql', 'sqlite'];
export const SQL_CAPABILITY_CATEGORIES: readonly SqlCapabilityCategory[];
export const SQL_CAPABILITY_SUPPORT_LEVELS: readonly SqlCapabilitySupportLevel[];
export const capabilityModel: SqlCapabilityModelApi;

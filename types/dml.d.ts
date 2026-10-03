import type {
  SqlAstExpression,
  SqlAstIdentifier,
  SqlCapabilityModelApi,
  SqlCapabilityTier1Dialect,
  SqlCompiledAst,
  SqlCompilerScope,
  SqlQueryAst,
  SqlRewritePlan,
  SqlTranspileOptions
} from './public';

export interface SqlAstAssignment {
  readonly type: 'Assignment';
  readonly column: SqlAstIdentifier;
  readonly value: SqlAstExpression;
}

export interface SqlInsertStatementAst {
  readonly type: 'InsertStatement';
  readonly target: SqlAstIdentifier;
  readonly columns: readonly SqlAstIdentifier[];
  readonly rows: readonly (readonly SqlAstExpression[])[];
  readonly source: SqlQueryAst | null;
  readonly returning: readonly SqlAstExpression[];
}

export interface SqlUpdateStatementAst {
  readonly type: 'UpdateStatement';
  readonly target: SqlAstIdentifier;
  readonly assignments: readonly SqlAstAssignment[];
  readonly where: SqlAstExpression | null;
  readonly returning: readonly SqlAstExpression[];
}

export interface SqlDeleteStatementAst {
  readonly type: 'DeleteStatement';
  readonly target: SqlAstIdentifier;
  readonly where: SqlAstExpression | null;
  readonly returning: readonly SqlAstExpression[];
}

export interface SqlConflictActionAst {
  readonly type: 'ConflictAction';
  readonly target: readonly SqlAstIdentifier[];
  readonly action: 'nothing' | 'update';
  readonly assignments: readonly SqlAstAssignment[];
  readonly where: SqlAstExpression | null;
}

export interface SqlUpsertStatementAst {
  readonly type: 'UpsertStatement';
  readonly syntax: 'on-conflict' | 'on-duplicate-key';
  readonly insert: SqlInsertStatementAst;
  readonly conflict: SqlConflictActionAst;
  readonly returning: readonly SqlAstExpression[];
}

export interface SqlMergeMatchedActionAst {
  readonly type: 'MergeMatchedAction';
  readonly action: 'update' | 'delete';
  readonly assignments: readonly SqlAstAssignment[];
}

export interface SqlMergeNotMatchedActionAst {
  readonly type: 'MergeNotMatchedAction';
  readonly columns: readonly SqlAstIdentifier[];
  readonly values: readonly SqlAstExpression[];
}

export interface SqlMergeStatementAst {
  readonly type: 'MergeStatement';
  readonly target: SqlAstIdentifier;
  readonly targetAlias: SqlAstIdentifier | null;
  readonly source: SqlAstIdentifier;
  readonly sourceAlias: SqlAstIdentifier | null;
  readonly on: SqlAstExpression;
  readonly matched: SqlMergeMatchedActionAst | null;
  readonly notMatched: SqlMergeNotMatchedActionAst | null;
}

export type SqlDmlAst = SqlInsertStatementAst | SqlUpdateStatementAst | SqlDeleteStatementAst | SqlUpsertStatementAst | SqlMergeStatementAst;
export type SqlStatementAst = SqlQueryAst | SqlDmlAst;
export type SqlDmlCompilerScope = 'dml-v1' | 'dml-v2';
export type SqlStatementCompilerScope = SqlCompilerScope | SqlDmlCompilerScope;
export type SqlStatementType = SqlStatementAst['type'];

export interface SqlStatementAstAnalysis {
  readonly statementType: SqlStatementType;
  readonly scope: SqlStatementCompilerScope;
  readonly capabilities: readonly string[];
}

export interface SqlStatementTranspileResult {
  readonly from: SqlCapabilityTier1Dialect;
  readonly to: SqlCapabilityTier1Dialect;
  readonly scope: SqlStatementCompilerScope;
  readonly ast: SqlStatementAst;
  readonly capabilities: readonly string[];
  readonly plan: SqlRewritePlan;
  readonly sql: string;
  readonly targetToSource: readonly (number | string)[];
  readonly lossless: boolean;
  readonly certified: boolean;
}

declare module './public' {
  interface SqlCapabilityModelApi {
    parseSql(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', sql: string): SqlStatementAst;
    analyzeAst(ast: SqlStatementAst): SqlStatementAstAnalysis;
    compileAst(dialect: SqlCapabilityTier1Dialect | 'postgres' | 'pg', ast: SqlStatementAst): SqlCompiledAst;
    transpileSql(from: SqlCapabilityTier1Dialect | 'postgres' | 'pg', to: SqlCapabilityTier1Dialect | 'postgres' | 'pg', sql: string, options?: SqlTranspileOptions): SqlStatementTranspileResult;
  }
}

export type DmlCapableSqlCapabilityModelApi = SqlCapabilityModelApi;
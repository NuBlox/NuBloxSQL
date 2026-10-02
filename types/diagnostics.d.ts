import type * as root from '../index';

export type QueryDiagnosticsDialect = 'mysql' | 'postgresql' | 'sqlite';
export type QueryDiagnosticsMode = 'plan' | 'analyze';
export type QueryDiagnosticsStatement = Parameters<root.Client['compile']>[0];

export interface QueryDiagnosticsOptions extends root.ClientOperationOptions {
  /** Execute the statement while collecting runtime plan evidence where the dialect supports EXPLAIN ANALYZE. */
  analyze?: boolean;

  /** MySQL only: permit EXPLAIN ANALYZE for non-SELECT/TABLE statements. */
  allowMutation?: boolean;

  /** SQLite only: include full VM opcode EXPLAIN output in the retained native report. */
  includeOpcodes?: boolean;
  /** SQLite only: include native source SQL in statement metadata. */
  includeSql?: boolean;
  /** SQLite only: include expanded SQL in statement metadata when available. */
  includeExpandedSql?: boolean;

  /** PostgreSQL EXPLAIN options. */
  verbose?: boolean;
  costs?: boolean;
  settings?: boolean;
  genericPlan?: boolean;
  buffers?: boolean;
  wal?: boolean;
  timing?: boolean;
  summary?: boolean;
  serialize?: 'none' | 'text' | 'binary';
  memory?: boolean;

  maxRows?: number;
  maxResultBytes?: number;
  maxRowBytes?: number;
}

export interface QueryDiagnosticsStatementDescriptor {
  readonly text: string;
  readonly parameterCount: number;
}

export interface QueryDiagnosticsSummary {
  readonly nodeCount: number | null;
  readonly maxDepth: number | null;
  readonly estimatedRows: number | null;
  readonly actualRows: number | null;
  readonly estimatedCost: number | null;
  readonly planningTimeMs: number | null;
  readonly executionTimeMs: number | null;
}

export interface QueryDiagnosticsWarning {
  readonly code: string;
  readonly message: string;
  readonly nodeId: number | null;
}

export interface QueryDiagnosticsReport<D extends root.Dialect = root.Dialect> {
  readonly schemaVersion: 1;
  readonly dialect: D;
  readonly mode: QueryDiagnosticsMode;
  readonly analyzed: boolean;
  readonly statementExecuted: boolean;
  readonly statement: QueryDiagnosticsStatementDescriptor;
  readonly summary: QueryDiagnosticsSummary;
  readonly warnings: readonly QueryDiagnosticsWarning[];
  /** Complete engine-native diagnostics report. Portable fields never replace this payload. */
  readonly native: unknown;
}

export const QUERY_DIAGNOSTICS_SCHEMA_VERSION: 1;

declare module '../index' {
  interface Client {
    diagnose(statement: QueryDiagnosticsStatement, options?: QueryDiagnosticsOptions): Promise<QueryDiagnosticsReport>;
  }
}

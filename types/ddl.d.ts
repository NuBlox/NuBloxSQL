import type { SqlAstExpression, SqlAstIdentifier, SqlAstTypeName, SqlQueryAst } from './public';

export interface SqlAstForeignKeyReference {
  readonly type: 'ForeignKeyReference';
  readonly table: SqlAstIdentifier;
  readonly columns: readonly SqlAstIdentifier[];
}

export interface SqlAstColumnDefinition {
  readonly type: 'ColumnDefinition';
  readonly name: SqlAstIdentifier;
  readonly dataType: SqlAstTypeName;
  readonly nullable: boolean | null;
  readonly default: SqlAstExpression | null;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly checks: readonly SqlAstExpression[];
  readonly references: SqlAstForeignKeyReference | null;
}

export interface SqlAstPrimaryKeyConstraint {
  readonly type: 'PrimaryKeyConstraint';
  readonly columns: readonly SqlAstIdentifier[];
}

export interface SqlAstUniqueConstraint {
  readonly type: 'UniqueConstraint';
  readonly columns: readonly SqlAstIdentifier[];
}

export interface SqlAstCheckConstraint {
  readonly type: 'CheckConstraint';
  readonly expression: SqlAstExpression;
}

export interface SqlAstForeignKeyConstraint {
  readonly type: 'ForeignKeyConstraint';
  readonly columns: readonly SqlAstIdentifier[];
  readonly references: SqlAstForeignKeyReference;
}

export type SqlAstTableConstraint =
  | SqlAstPrimaryKeyConstraint
  | SqlAstUniqueConstraint
  | SqlAstCheckConstraint
  | SqlAstForeignKeyConstraint;

export interface SqlCreateTableStatementAst {
  readonly type: 'CreateTableStatement';
  readonly name: SqlAstIdentifier;
  readonly columns: readonly SqlAstColumnDefinition[];
  readonly constraints: readonly SqlAstTableConstraint[];
}

export interface SqlCreateIndexStatementAst {
  readonly type: 'CreateIndexStatement';
  readonly name: SqlAstIdentifier;
  readonly table: SqlAstIdentifier;
  readonly columns: readonly SqlAstIdentifier[];
  readonly unique: boolean;
  readonly where: SqlAstExpression | null;
}

export interface SqlCreateViewStatementAst {
  readonly type: 'CreateViewStatement';
  readonly name: SqlAstIdentifier;
  readonly query: SqlQueryAst;
}

export interface SqlCreateSchemaStatementAst {
  readonly type: 'CreateSchemaStatement';
  readonly name: SqlAstIdentifier;
}

export interface SqlCreateSequenceStatementAst {
  readonly type: 'CreateSequenceStatement';
  readonly name: SqlAstIdentifier;
}

export interface SqlDropTableStatementAst {
  readonly type: 'DropTableStatement';
  readonly name: SqlAstIdentifier;
}

export interface SqlDropViewStatementAst {
  readonly type: 'DropViewStatement';
  readonly name: SqlAstIdentifier;
}

export interface SqlAlterTableAddColumnActionAst {
  readonly type: 'AddColumnAction';
  readonly column: SqlAstColumnDefinition;
}

export interface SqlAlterTableDropColumnActionAst {
  readonly type: 'DropColumnAction';
  readonly column: SqlAstIdentifier;
}

export interface SqlAlterTableRenameColumnActionAst {
  readonly type: 'RenameColumnAction';
  readonly from: SqlAstIdentifier;
  readonly to: SqlAstIdentifier;
}

export interface SqlAlterTableRenameTableActionAst {
  readonly type: 'RenameTableAction';
  readonly to: SqlAstIdentifier;
}

export type SqlAlterTableActionAst =
  | SqlAlterTableAddColumnActionAst
  | SqlAlterTableDropColumnActionAst
  | SqlAlterTableRenameColumnActionAst
  | SqlAlterTableRenameTableActionAst;

export interface SqlAlterTableStatementAst {
  readonly type: 'AlterTableStatement';
  readonly table: SqlAstIdentifier;
  readonly action: SqlAlterTableActionAst;
}

export type SqlDdlAst =
  | SqlCreateTableStatementAst
  | SqlCreateIndexStatementAst
  | SqlCreateViewStatementAst
  | SqlCreateSchemaStatementAst
  | SqlCreateSequenceStatementAst
  | SqlDropTableStatementAst
  | SqlDropViewStatementAst
  | SqlAlterTableStatementAst;

export type SqlDdlCompilerScope = 'ddl-v1' | 'ddl-v2';

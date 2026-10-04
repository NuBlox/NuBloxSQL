import type { SqlAstExpression, SqlAstIdentifier, SqlAstTypeName, SqlQueryAst } from './public';

export type SqlForeignKeyAction = 'no-action' | 'restrict' | 'cascade' | 'set-null' | 'set-default';
export type SqlForeignKeyMatch = 'simple' | 'full' | 'partial';
export type SqlForeignKeyInitialMode = 'deferred' | 'immediate';
export interface SqlAstForeignKeyReference { readonly type: 'ForeignKeyReference'; readonly table: SqlAstIdentifier; readonly columns: readonly SqlAstIdentifier[]; readonly match?: SqlForeignKeyMatch; readonly onDelete?: SqlForeignKeyAction; readonly onUpdate?: SqlForeignKeyAction; readonly deferrable?: boolean; readonly initially?: SqlForeignKeyInitialMode; }
export interface SqlAstGeneratedColumn { readonly storage: 'stored' | 'virtual'; readonly expression: SqlAstExpression; }
export interface SqlAstIdentityColumn { readonly mode: 'always' | 'by-default'; }
export interface SqlAstColumnDefinition { readonly type: 'ColumnDefinition'; readonly name: SqlAstIdentifier; readonly dataType: SqlAstTypeName; readonly nullable: boolean | null; readonly default: SqlAstExpression | null; readonly primaryKey: boolean; readonly unique: boolean; readonly checks: readonly SqlAstExpression[]; readonly references: SqlAstForeignKeyReference | null; readonly generated?: SqlAstGeneratedColumn; readonly identity?: SqlAstIdentityColumn; }
export interface SqlAstPrimaryKeyConstraint { readonly type: 'PrimaryKeyConstraint'; readonly columns: readonly SqlAstIdentifier[]; }
export interface SqlAstUniqueConstraint { readonly type: 'UniqueConstraint'; readonly columns: readonly SqlAstIdentifier[]; }
export interface SqlAstCheckConstraint { readonly type: 'CheckConstraint'; readonly expression: SqlAstExpression; }
export interface SqlAstForeignKeyConstraint { readonly type: 'ForeignKeyConstraint'; readonly columns: readonly SqlAstIdentifier[]; readonly references: SqlAstForeignKeyReference; }
export type SqlAstTableConstraint = SqlAstPrimaryKeyConstraint | SqlAstUniqueConstraint | SqlAstCheckConstraint | SqlAstForeignKeyConstraint;
export type SqlDropDependencyMode = 'cascade' | 'restrict';

export interface SqlCreateTableStatementAst { readonly type: 'CreateTableStatement'; readonly name: SqlAstIdentifier; readonly columns: readonly SqlAstColumnDefinition[]; readonly constraints: readonly SqlAstTableConstraint[]; readonly ifNotExists?: boolean; }
export type SqlIndexKeyDirection = 'ASC' | 'DESC';
export type SqlIndexNullsOrder = 'FIRST' | 'LAST';
export interface SqlAstIndexColumnKey { readonly type: 'IndexColumnKey'; readonly column: SqlAstIdentifier; readonly direction?: SqlIndexKeyDirection | null; readonly collation?: SqlAstIdentifier | null; readonly operatorClass?: SqlAstIdentifier | null; readonly nulls?: SqlIndexNullsOrder | null; }
export interface SqlAstIndexExpressionKey { readonly type: 'IndexExpressionKey'; readonly expression: SqlAstExpression; readonly family: 'expression' | 'functional'; readonly direction?: SqlIndexKeyDirection | null; readonly collation?: SqlAstIdentifier | null; readonly operatorClass?: SqlAstIdentifier | null; readonly nulls?: SqlIndexNullsOrder | null; }
export type SqlAstIndexKey = SqlAstIndexColumnKey | SqlAstIndexExpressionKey;
export interface SqlCreateIndexStatementAst { readonly type: 'CreateIndexStatement'; readonly name: SqlAstIdentifier; readonly table: SqlAstIdentifier; readonly columns: readonly SqlAstIdentifier[]; readonly keys?: readonly SqlAstIndexKey[]; readonly unique: boolean; readonly where: SqlAstExpression | null; readonly ifNotExists?: boolean; readonly concurrently?: boolean; readonly method?: 'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin' | null; readonly include?: readonly SqlAstIdentifier[]; }
export interface SqlCreateViewStatementAst { readonly type: 'CreateViewStatement'; readonly name: SqlAstIdentifier; readonly query: SqlQueryAst; }
export interface SqlCreateSchemaStatementAst { readonly type: 'CreateSchemaStatement'; readonly name: SqlAstIdentifier; readonly ifNotExists?: boolean; }
export interface SqlCreateSequenceStatementAst { readonly type: 'CreateSequenceStatement'; readonly name: SqlAstIdentifier; readonly ifNotExists?: boolean; }
export interface SqlDropTableStatementAst { readonly type: 'DropTableStatement'; readonly name: SqlAstIdentifier; readonly ifExists?: boolean; readonly dependencyMode?: SqlDropDependencyMode; }
export interface SqlDropViewStatementAst { readonly type: 'DropViewStatement'; readonly name: SqlAstIdentifier; readonly ifExists?: boolean; readonly dependencyMode?: SqlDropDependencyMode; }
export interface SqlDropIndexStatementAst { readonly type: 'DropIndexStatement'; readonly name: SqlAstIdentifier; readonly table: SqlAstIdentifier | null; readonly ifExists: boolean; readonly concurrently?: boolean; readonly dependencyMode?: SqlDropDependencyMode; }
export interface SqlDropSchemaStatementAst { readonly type: 'DropSchemaStatement'; readonly name: SqlAstIdentifier; readonly table: null; readonly ifExists: boolean; readonly dependencyMode?: SqlDropDependencyMode; }
export interface SqlDropSequenceStatementAst { readonly type: 'DropSequenceStatement'; readonly name: SqlAstIdentifier; readonly table: null; readonly ifExists: boolean; readonly dependencyMode?: SqlDropDependencyMode; }

export interface SqlAlterTableAddColumnActionAst { readonly type: 'AddColumnAction'; readonly column: SqlAstColumnDefinition; }
export interface SqlAlterTableDropColumnActionAst { readonly type: 'DropColumnAction'; readonly column: SqlAstIdentifier; }
export interface SqlAlterTableRenameColumnActionAst { readonly type: 'RenameColumnAction'; readonly from: SqlAstIdentifier; readonly to: SqlAstIdentifier; }
export interface SqlAlterTableRenameTableActionAst { readonly type: 'RenameTableAction'; readonly to: SqlAstIdentifier; }
export interface SqlAlterColumnTypeActionAst { readonly type: 'AlterColumnTypeAction'; readonly column: SqlAstIdentifier; readonly dataType: SqlAstTypeName; }
export interface SqlSetColumnDefaultActionAst { readonly type: 'SetColumnDefaultAction'; readonly column: SqlAstIdentifier; readonly expression: SqlAstExpression; }
export interface SqlDropColumnDefaultActionAst { readonly type: 'DropColumnDefaultAction'; readonly column: SqlAstIdentifier; }
export interface SqlSetColumnNotNullActionAst { readonly type: 'SetColumnNotNullAction'; readonly column: SqlAstIdentifier; }
export interface SqlDropColumnNotNullActionAst { readonly type: 'DropColumnNotNullAction'; readonly column: SqlAstIdentifier; }
export interface SqlAddConstraintActionAst { readonly type: 'AddConstraintAction'; readonly name: SqlAstIdentifier; readonly constraint: SqlAstTableConstraint; }
export interface SqlDropConstraintActionAst { readonly type: 'DropConstraintAction'; readonly name: SqlAstIdentifier; }
export type SqlAlterTableActionAst = SqlAlterTableAddColumnActionAst | SqlAlterTableDropColumnActionAst | SqlAlterTableRenameColumnActionAst | SqlAlterTableRenameTableActionAst | SqlAlterColumnTypeActionAst | SqlSetColumnDefaultActionAst | SqlDropColumnDefaultActionAst | SqlSetColumnNotNullActionAst | SqlDropColumnNotNullActionAst | SqlAddConstraintActionAst | SqlDropConstraintActionAst;
export interface SqlAlterTableStatementAst { readonly type: 'AlterTableStatement'; readonly table: SqlAstIdentifier; readonly action: SqlAlterTableActionAst; }

export type SqlDdlAst = SqlCreateTableStatementAst | SqlCreateIndexStatementAst | SqlCreateViewStatementAst | SqlCreateSchemaStatementAst | SqlCreateSequenceStatementAst | SqlDropTableStatementAst | SqlDropViewStatementAst | SqlDropIndexStatementAst | SqlDropSchemaStatementAst | SqlDropSequenceStatementAst | SqlAlterTableStatementAst;
export type SqlDdlCompilerScope = 'ddl-v1' | 'ddl-v2' | 'ddl-v3' | 'ddl-v4' | 'ddl-v5' | 'ddl-v6' | 'ddl-v7' | 'ddl-v8' | 'ddl-v9';

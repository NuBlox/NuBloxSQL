import type * as root from '../index';

export type DataMovementStatus = 'succeeded' | 'failed' | 'dry-run';
export type DataMovementInvalidRowPolicy = 'stop' | 'skip';

export interface DataMovementClient {
  readonly dialect: root.Dialect;
  compile(statement: root.SqlFragment | string): root.CompiledSql;
  all<Row = Record<string, unknown>>(statement: root.SqlFragment | string, options?: root.ClientOperationOptions): Promise<Row[]>;
  execute<Row = Record<string, unknown>>(statement: root.SqlFragment | string, options?: root.ClientOperationOptions): Promise<root.ClientResult<Row>>;
  stream<Row = Record<string, unknown>>(statement: root.SqlFragment | string, options?: root.ClientStreamOptions): root.ClientRowStream<Row>;
}

export interface DataMovementColumnMapping {
  readonly source: string;
  readonly target: string;
  readonly required?: boolean;
}

export interface DataMovementSpec {
  readonly source: {
    readonly statement: root.SqlFragment | string;
  };
  readonly target: {
    readonly table: string | readonly string[];
    readonly columns: readonly (string | DataMovementColumnMapping)[];
  };
}

export interface DataMovementCheckpoint {
  readonly schemaVersion: 1;
  readonly dataMovementSchemaVersion: 1;
  readonly planHash: string;
  readonly rowOffset: number;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly rowsSkipped: number;
  readonly failedRow: number | null;
}

export interface DataMovementAuditRecord {
  readonly row?: number;
  readonly firstRow?: number;
  readonly rows?: number;
  readonly status: 'planned' | 'succeeded' | 'skipped';
  readonly error?: Readonly<{ name: string; message: string }>;
}

export interface DataMovementContext {
  readonly sourceRow: Readonly<Record<string, unknown>>;
  readonly row: number;
  readonly sourceClient: DataMovementClient;
  readonly targetClient: DataMovementClient;
}

export interface DataMovementOptions {
  readonly batchSize?: number;
  readonly dryRun?: boolean;
  readonly onInvalid?: DataMovementInvalidRowPolicy;
  readonly source?: root.ClientStreamOptions;
  readonly operation?: root.ClientOperationOptions;
  readonly resumeFrom?: DataMovementCheckpoint;
  readonly clock?: () => number;
  readonly transformRow?: (
    row: Readonly<Record<string, unknown>>,
    context: DataMovementContext
  ) => Readonly<Record<string, unknown>> | void | Promise<Readonly<Record<string, unknown>> | void>;
  readonly validateRow?: (
    row: Readonly<Record<string, unknown>>,
    context: DataMovementContext
  ) => true | void | string | Promise<true | void | string>;
  readonly onCheckpoint?: (checkpoint: DataMovementCheckpoint) => void | Promise<void>;
  readonly onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

export interface DataMovementResult {
  readonly schemaVersion: 1;
  readonly status: DataMovementStatus;
  readonly dryRun: boolean;
  readonly planHash: string;
  readonly sourceDialect: root.Dialect | null;
  readonly targetDialect: root.Dialect | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly rowsSkipped: number;
  readonly checkpoint: DataMovementCheckpoint;
  readonly audit: readonly DataMovementAuditRecord[];
  readonly error: Readonly<{ name: string; message: string; row: number | null }> | null;
}

export const DATA_MOVEMENT_SCHEMA_VERSION: 1;
export const DATA_MOVEMENT_CHECKPOINT_SCHEMA_VERSION: 1;
export const DATA_MOVEMENT_STATUSES: readonly DataMovementStatus[];
export const DATA_MOVEMENT_INVALID_ROW_POLICIES: readonly DataMovementInvalidRowPolicy[];

export function moveData(
  sourceClient: DataMovementClient,
  targetClient: DataMovementClient,
  spec: DataMovementSpec,
  options?: DataMovementOptions
): Promise<DataMovementResult>;

export function resumeDataMovement(
  sourceClient: DataMovementClient,
  targetClient: DataMovementClient,
  spec: DataMovementSpec,
  checkpoint: DataMovementCheckpoint,
  options?: DataMovementOptions
): Promise<DataMovementResult>;

declare module './index' {
  interface Client {
    moveDataTo(
      targetClient: DataMovementClient,
      spec: DataMovementSpec,
      options?: DataMovementOptions
    ): Promise<DataMovementResult>;
    resumeDataMovementTo(
      targetClient: DataMovementClient,
      spec: DataMovementSpec,
      checkpoint: DataMovementCheckpoint,
      options?: DataMovementOptions
    ): Promise<DataMovementResult>;
  }
}

import mysql = require('./index');

export interface BinlogDecoderOptions {
  checksumBytes?: number;
  maxEventSize?: number;
}

export interface BinlogEvent {
  timestamp: number;
  type: number;
  typeName: string;
  serverId: number;
  eventSize: number;
  logPosition: number;
  flags: number;
  payload: Buffer;
  checksum: Buffer | null;
  position?: bigint;
  nextBinlog?: string;
  threadId?: number;
  executionTime?: number;
  errorCode?: number;
  statusVariables?: Buffer;
  schema?: string;
  query?: string;
  binlogVersion?: number;
  serverVersion?: string;
  createTimestamp?: number;
  commonHeaderLength?: number;
  eventHeaderLengths?: Buffer;
  xid?: bigint;
  tableId?: number;
  tableFlags?: number;
  database?: string;
  table?: string;
  columnCount?: number;
  columnTypes?: Buffer;
  columnMetadata?: Buffer;
  nullBitmap?: Buffer;
  extraData?: Buffer;
}

export interface BinlogEventTypeMap {
  readonly [name: string]: number | string;
  readonly [value: number]: string;
}

export interface BinlogDumpOptions {
  filename: string;
  position?: number;
  flags?: number;
  serverId?: number;
  timeout?: number;
  signal?: mysql.AbortSignalLike;
  decoder?: BinlogEventDecoder;
  decoderOptions?: BinlogDecoderOptions;
}

export interface BinlogEventStream extends NodeJS.ReadableStream, AsyncIterable<BinlogEvent> {}

export interface BinlogDumpSequence {
  stream(options?: {highWaterMark?: number}): BinlogEventStream;
  stop(): void;
  on(event: 'event', listener: (event: BinlogEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;
}

export interface ReplicationConnection extends mysql.Connection {
  binlogDump(options: BinlogDumpOptions, callback?: (error?: Error | null) => void): BinlogDumpSequence;
}

export class BinlogEventDecoder {
  readonly checksumBytes: number;
  readonly maxEventSize: number;
  constructor(options?: BinlogDecoderOptions);
  decode(input: Buffer): BinlogEvent;
}

export const EventTypes: BinlogEventTypeMap;
export function createDecoder(options?: BinlogDecoderOptions): BinlogEventDecoder;
export function createReplicationConnection(config: mysql.ConnectionConfig): ReplicationConnection;
export default createDecoder;

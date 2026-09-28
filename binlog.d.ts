import mysql = require('./index');

export type BinlogChecksumBytes = number | 'auto';
export type BinlogChecksumAlgorithm = 'unknown' | 'undefined' | 'off' | 'crc32' | 'manual';

export interface BinlogDecoderOptions {
  checksumBytes?: BinlogChecksumBytes;
  verifyChecksum?: boolean;
  maxEventSize?: number;
}

export interface BinlogGtidInterval {
  start: bigint;
  end: bigint;
}

export interface BinlogPreviousGtidSid {
  sid: Buffer;
  sidText: string;
  intervals: BinlogGtidInterval[];
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
  checksumAlgorithm: BinlogChecksumAlgorithm;
  checksumVerified: boolean;
  checksumValue?: number;
  computedChecksum?: number;
  checksumAlgorithmCode?: number;
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
  gtidFlags?: number;
  sid?: Buffer;
  sidText?: string;
  gno?: bigint;
  gtid?: string | null;
  anonymous?: boolean;
  logicalTimestampType?: number;
  lastCommitted?: bigint;
  sequenceNumber?: bigint;
  gtidExtension?: Buffer;
  previousGtids?: BinlogPreviousGtidSid[];
  previousGtidSidCount?: number;
  previousGtidIntervalCount?: number;
  gtidSetExtension?: Buffer;
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
  readonly checksumMode: 'auto' | 'manual';
  readonly checksumBytes: number;
  readonly checksumAlgorithm: BinlogChecksumAlgorithm;
  readonly verifyChecksum: boolean;
  readonly maxEventSize: number;
  constructor(options?: BinlogDecoderOptions);
  decode(input: Buffer): BinlogEvent;
}

export const EventTypes: BinlogEventTypeMap;
export function createDecoder(options?: BinlogDecoderOptions): BinlogEventDecoder;
export function createReplicationConnection(config: string | mysql.ConnectionOptions): ReplicationConnection;
export default createDecoder;

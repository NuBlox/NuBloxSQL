export interface SqlServerDialectDescriptor {
  readonly identity: Readonly<{ family: 'sqlserver'; name: 'Microsoft SQL Server'; status: 'development' }>;
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly plannedCapabilities: Readonly<Record<string, boolean>>;
  readonly services: Readonly<{
    quoteIdentifier(identifier: string): string;
    placeholder(index: number): string;
  }>;
  supports(capability: string): boolean;
}

export interface TdsPacket {
  readonly type: number;
  readonly status: number;
  readonly length: number;
  readonly spid: number;
  readonly packetId: number;
  readonly window: number;
  readonly payload: Buffer;
  readonly bytesConsumed: number;
  readonly endOfMessage: boolean;
}

export interface TdsPacketOptions {
  type: number;
  status?: number;
  spid?: number;
  packetId?: number;
  window?: number;
  payload?: Uint8Array;
}

export interface PreloginOptions {
  version?: { major?: number; minor?: number; build?: number; subbuild?: number };
  encryption?: number;
  instance?: string;
  threadId?: number;
  mars?: boolean;
  fedAuthRequired?: boolean;
  nonce?: Uint8Array;
}

export const descriptor: SqlServerDialectDescriptor;
export const capabilities: Readonly<Record<string, boolean>>;
export const plannedCapabilities: Readonly<Record<string, boolean>>;
export const services: SqlServerDialectDescriptor['services'];

export const TdsPacket: {
  readonly HEADER_LENGTH: 8;
  readonly MAX_PACKET_LENGTH: 32767;
  readonly DEFAULT_PACKET_SIZE: 4096;
  readonly PACKET_TYPES: Readonly<Record<string, number>>;
  readonly STATUS: Readonly<Record<string, number>>;
  encodePacket(options: TdsPacketOptions): Buffer;
  decodePacket(buffer: Uint8Array): TdsPacket;
  packetize(type: number, payload?: Uint8Array, options?: { packetSize?: number; packetId?: number; spid?: number; window?: number }): Buffer[];
  PacketParser: new () => { push(chunk: Uint8Array): TdsPacket[]; bufferedBytes(): number };
};

export const Prelogin: {
  readonly TOKENS: Readonly<Record<string, number>>;
  readonly ENCRYPTION: Readonly<Record<string, number>>;
  versionBytes(version?: PreloginOptions['version']): Buffer;
  encode(options?: PreloginOptions): Buffer;
  decode(payload: Uint8Array): Readonly<Record<string, unknown>>;
};

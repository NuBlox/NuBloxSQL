export interface SqlServerDialectDescriptor {
  readonly identity: Readonly<{ family: 'sqlserver'; name: 'Microsoft SQL Server'; status: 'development' }>;
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly plannedCapabilities: Readonly<Record<string, boolean>>;
  readonly services: Readonly<{ quoteIdentifier(identifier: string): string; placeholder(index: number): string }>;
  supports(capability: string): boolean;
}
export interface TdsPacket { readonly type:number; readonly status:number; readonly length:number; readonly spid:number; readonly packetId:number; readonly window:number; readonly payload:Buffer; readonly bytesConsumed:number; readonly endOfMessage:boolean }
export interface TdsPacketOptions { type:number; status?:number; spid?:number; packetId?:number; window?:number; payload?:Uint8Array }
export interface PreloginOptions { version?:{major?:number;minor?:number;build?:number;subbuild?:number}; encryption?:number; instance?:string; threadId?:number; mars?:boolean; fedAuthRequired?:boolean; nonce?:Uint8Array }
export interface Login7Options { hostName?:string; userName?:string; user?:string; password?:string; appName?:string; serverName?:string; host?:string; clientInterfaceName?:string; language?:string; database?:string; attachDbFile?:string; changePassword?:string; packetSize?:number; tdsVersion?:number; clientProgramVersion?:number; clientPid?:number; connectionId?:number; optionFlags1?:number; optionFlags2?:number; typeFlags?:number; optionFlags3?:number; readOnlyIntent?:boolean; clientTimeZone?:number; clientLcid?:number; clientId?:Uint8Array }
export interface SqlServerConnectionConfig extends Login7Options { host?:string; port?:number; connectTimeout?:number; queryTimeout?:number; serverName?:string; hostnameInCertificate?:string; rejectUnauthorized?:boolean; minTlsVersion?:string; ca?:unknown; cert?:unknown; key?:unknown; pfx?:unknown; passphrase?:string; ciphers?:string; mars?:boolean; clientVersion?:{major?:number;minor?:number;build?:number;subbuild?:number} }
export interface SqlServerColumn { readonly name:string; readonly userType:number; readonly flags:number; readonly nullable:boolean; readonly type:number; readonly maxLength:number|null; readonly collation:Buffer|null }
export interface SqlServerNativeError { readonly type:'error'; readonly number:number; readonly state:number; readonly severity:number; readonly message:string; readonly serverName:string; readonly procedureName:string; readonly lineNumber:number }
export interface SqlServerEnvChange { readonly type:'envchange'; readonly changeType:number; readonly newValue:string|Buffer; readonly oldValue:string|Buffer; readonly newRaw:Buffer; readonly oldRaw:Buffer }
export interface SqlServerQueryResult<Row=Record<string,unknown>> { readonly columns:readonly SqlServerColumn[]; readonly rows:readonly Row[]; readonly errors:readonly SqlServerNativeError[]; readonly info:readonly unknown[]; readonly envChanges:readonly SqlServerEnvChange[]; readonly order:readonly number[]; readonly rowCount:bigint; readonly done:unknown; readonly success:boolean }
export interface SqlServerOperationOptions { timeout?:number }
export interface SqlServerTransactionOptions extends SqlServerOperationOptions { isolationLevel?:'read-uncommitted'|'read-committed'|'repeatable-read'|'serializable'; readOnly?:never; deferrable?:never }
export class SqlServerError extends Error { readonly code?:number|string|null; readonly severity?:number|null; readonly state?:number|null; readonly native?:unknown; readonly alpnProtocol?:string|null; readonly cause?:unknown; readonly result?:unknown }
export class Connection {
  constructor(config?:SqlServerConnectionConfig);
  readonly config:SqlServerConnectionConfig;
  connected:boolean; ended:boolean; packetSize:number; serverPrelogin:unknown; loginResponse:unknown; transactionDescriptor:bigint;
  connect():Promise<this>;
  query<Row=Record<string,unknown>>(sqlText:string,options?:SqlServerOperationOptions):Promise<SqlServerQueryResult<Row>>;
  queryParameters<Row=Record<string,unknown>>(sqlText:string,values:readonly unknown[],options?:SqlServerOperationOptions):Promise<SqlServerQueryResult<Row>>;
  execute<Row=Record<string,unknown>>(sqlText:string,options?:SqlServerOperationOptions):Promise<SqlServerQueryResult<Row>>;
  execute<Row=Record<string,unknown>>(sqlText:string,values:readonly unknown[],options?:SqlServerOperationOptions):Promise<SqlServerQueryResult<Row>>;
  executeParameters<Row=Record<string,unknown>>(sqlText:string,values:readonly unknown[],options?:SqlServerOperationOptions):Promise<SqlServerQueryResult<Row>>;
  beginTransaction(options?:SqlServerTransactionOptions):Promise<this>;
  commit(options?:SqlServerOperationOptions):Promise<this>;
  rollback(options?:SqlServerOperationOptions):Promise<this>;
  savepoint(name:string,options?:SqlServerOperationOptions):Promise<unknown>;
  rollbackToSavepoint(name:string,options?:SqlServerOperationOptions):Promise<unknown>;
  releaseSavepoint(name:string,options?:SqlServerOperationOptions):Promise<this>;
  withTransaction<T>(fn:(connection:this)=>T|Promise<T>,options?:SqlServerTransactionOptions):Promise<T>;
  end():Promise<void>; close():Promise<void>;
}
export function createConnection(config?:SqlServerConnectionConfig):Connection;
export const descriptor:SqlServerDialectDescriptor;
export const capabilities:Readonly<{ rawQuery:true; transactions:true; savepoints:true; nestedTransactions:true; transactionIsolation:true; readOnlyTransactions:false; deferrableTransactions:false } & Record<string,boolean>>;
export const plannedCapabilities:Readonly<Record<string,boolean>>;
export const services:SqlServerDialectDescriptor['services'];
export const TdsPacket:{ readonly HEADER_LENGTH:8; readonly MAX_PACKET_LENGTH:32767; readonly DEFAULT_PACKET_SIZE:4096; readonly PACKET_TYPES:Readonly<Record<string,number>>; readonly STATUS:Readonly<Record<string,number>>; encodePacket(options:TdsPacketOptions):Buffer; decodePacket(buffer:Uint8Array):TdsPacket; packetize(type:number,payload?:Uint8Array,options?:{packetSize?:number;packetId?:number;spid?:number;window?:number}):Buffer[]; PacketParser:new()=>{push(chunk:Uint8Array):TdsPacket[];bufferedBytes():number} };
export const Prelogin:{ readonly TOKENS:Readonly<Record<string,number>>; readonly ENCRYPTION:Readonly<Record<string,number>>; versionBytes(version?:PreloginOptions['version']):Buffer; encode(options?:PreloginOptions):Buffer; decode(payload:Uint8Array):Readonly<Record<string,unknown>> };
export const Login7:{ readonly FIXED_LENGTH:94; readonly MAX_LENGTH:number; readonly TDS_74:number; encode(options?:Login7Options):Buffer; obfuscatePassword(value:string|Uint8Array):Buffer; decodePasswordBytes(value:Uint8Array):Buffer };
export const TokenStream:{ readonly TOKENS:Readonly<Record<string,number>>; readonly DONE_STATUS:Readonly<Record<string,number>>; readonly ENVCHANGE_TYPES:Readonly<Record<string,number>>; parseLoginResponse(payload:Uint8Array):Readonly<Record<string,unknown>> };
export const ResultStream:{ readonly TOKENS:Readonly<Record<string,number>>; readonly TYPES:Readonly<Record<string,number>>; parse(payload:Uint8Array):SqlServerQueryResult };
export const AllHeaders:{ readonly HEADER_TYPE_TRANSACTION_DESCRIPTOR:number; readonly TRANSACTION_HEADER_LENGTH:number; readonly TOTAL_LENGTH:number; transaction(transactionDescriptor?:bigint|number,outstandingRequestCount?:number):Buffer; sqlBatch(sqlText:string,transactionDescriptor?:bigint|number):Buffer };

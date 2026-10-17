/**
 * NuBloxSQL Driver: first public multi-engine native SQL connection contract.
 *
 * Database models are intentionally explicit. This is a RELATIONAL SQL client,
 * not a promise that graph/document/key-value engines accept SQL.
 * Each vendor adapter owns its native protocol or embedded engine binding.
 */
import {NativePgClient, type NativePgConfig} from './adapters/postgresql/wire.js';
import {SqliteAdapter, type SqliteTarget, type SqlBoundValue, type SqlResult} from './adapters/sqlite/connection.js';

export type {SqliteTarget, SqlBoundValue, SqlResult} from './adapters/sqlite/connection.js';

export type PostgreSqlTarget={
  engine:'postgresql';host:string;port:number;database:string;user:string;password:string;
  security:'isolated-local'|'verified-tls';caCertificate?:string;
  timeoutMs?:number;
};
export type DatabaseTarget=PostgreSqlTarget|SqliteTarget;
export type RelationalEngine=DatabaseTarget['engine'];
export type DriverCapability='sql.parameter-binding.text-numeric'|'sql.query.rows-bounded'|'transport.verified-tls';
export type SqlDatabaseInfo={
  model:'relational';
  engine:RelationalEngine;
  transport:'isolated-local'|'verified-tls'|'embedded';
  capabilities:readonly DriverCapability[];
};
export type SqlDatabaseSession={
  readonly info:Readonly<SqlDatabaseInfo>;
  query(sql:string,parameters?:readonly SqlBoundValue[]):Promise<SqlResult>;
  close():Promise<void>;
};
export type ClientFailureCode='UNSUPPORTED_ENGINE'|'INVALID_INPUT'|'CONNECTION_FAILED'|'OPERATION_FAILED'|'TIMEOUT'|'RESOURCE_LIMIT';
export class DriverError extends Error {
  readonly code:ClientFailureCode;
  readonly nativeCode?:string;
  constructor(code:ClientFailureCode, nativeCode?:string) {
    const message={
      UNSUPPORTED_ENGINE:'This database engine does not have a qualified native adapter.',
      INVALID_INPUT:'Invalid database target or operation input.',
      CONNECTION_FAILED:'Could not open a native database connection.',
      OPERATION_FAILED:'Native database operation failed.',
      TIMEOUT:'The native database operation timed out.',
      RESOURCE_LIMIT:'A native database resource limit was exceeded.'
    }[code];
    super(message);
    this.name='DriverError';
    this.code=code;
    if(nativeCode&&/^[A-Z0-9_]{4,48}$/.test(nativeCode))this.nativeCode=nativeCode;
  }
}
function checkedError(error:unknown,opening:boolean):DriverError{
  if(error instanceof DriverError)return error;
  const code=typeof error==='object'&&error!==null&&'code' in error?
    String(error.code):undefined;
  if(code==='ETIMEDOUT'||code==='57014')return new DriverError('TIMEOUT',code);
  if(code?.startsWith('NUBLOX_'))return new DriverError('RESOURCE_LIMIT',code);
  return new DriverError(opening?'CONNECTION_FAILED':'OPERATION_FAILED',
    code&&/^[A-Z0-9_]{4,48}$/.test(code)?code:undefined);
}
function validateSql(sql:string,values:readonly SqlBoundValue[]):void {
  if(typeof sql!=='string'||!sql.trim()||sql.includes('\0')||
    !Array.isArray(values)||values.length>16||
    values.some(v=>!((typeof v==='string'&&v.length<=16384)||
      (typeof v==='number'&&Number.isFinite(v)))))
    throw new DriverError('INVALID_INPUT');
}
function isObject(value:unknown):value is Record<string,unknown>{
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}
const PG_KEYS=new Set(['engine','host','port','database','user','password','security','caCertificate','timeoutMs']);
function postgresConfig(target:PostgreSqlTarget):NativePgConfig {
  if(Object.keys(target).some(k=>!PG_KEYS.has(k))||
    typeof target.host!=='string'||!target.host||
    !Number.isInteger(target.port)||target.port<1||target.port>65535||
    typeof target.database!=='string'||!target.database||
    typeof target.user!=='string'||!target.user||
    typeof target.password!=='string'||!target.password||
    (target.security!=='isolated-local'&&target.security!=='verified-tls')||
    (target.caCertificate!==undefined&&(typeof target.caCertificate!=='string'||!target.caCertificate))||
    (target.timeoutMs!==undefined&&(!Number.isInteger(target.timeoutMs)||target.timeoutMs<100||target.timeoutMs>60000)))
    throw new DriverError('INVALID_INPUT');
  if(target.security==='isolated-local'&&target.host!=='127.0.0.1'&&target.host!=='::1')
    throw new DriverError('INVALID_INPUT');
  if(target.security==='isolated-local'&&target.caCertificate!==undefined)
    throw new DriverError('INVALID_INPUT');
  const timeout=target.timeoutMs??15000;
  return {host:target.host,port:target.port,user:target.user,database:target.database,
    password:target.password,
    ssl:target.security==='verified-tls'?
      {rejectUnauthorized:true,servername:target.host,
        ...(target.caCertificate?{ca:target.caCertificate}:{})}:false,
    connectionTimeoutMillis:timeout,query_timeout:timeout,statement_timeout:timeout,
    application_name:'nubloxsql-native-client'};
}
/**
 * Opens a real database session. Unknown vendors/models fail before networking.
 * SQL is executed with the database principal's actual privileges; this API
 * does not claim that arbitrary queries are read-only.
 */
export async function connectDatabase(target:DatabaseTarget):Promise<SqlDatabaseSession>{
  if(!isObject(target)||!('engine' in target))throw new DriverError('INVALID_INPUT');
  if(target.engine==='postgresql'){
    let config:NativePgConfig;
    try{config=postgresConfig(target as PostgreSqlTarget);}
    catch{throw new DriverError('INVALID_INPUT');}
    const client=new NativePgClient(config);
    try{await client.connect();}
    catch(e){throw checkedError(e,true);}
    let closed=false;
    const info:SqlDatabaseInfo=Object.freeze({
      model:'relational',engine:'postgresql',
      transport:target.security==='verified-tls'?'verified-tls':'isolated-local',
      capabilities:Object.freeze([
        'sql.parameter-binding.text-numeric','sql.query.rows-bounded',
        ...(target.security==='verified-tls'?['transport.verified-tls'] as const:[])
      ] as DriverCapability[])
    });
    return {info,
      async query(sql,parameters=[]){
        if(closed)throw new DriverError('OPERATION_FAILED');
        validateSql(sql,parameters);
        try{return await client.query(sql,parameters);}
        catch(e){throw checkedError(e,false);}
      },
      async close(){if(!closed){closed=true;await client.end();}}
    };
  }
  if(target.engine==='sqlite'){
    const allowed=new Set(['engine','mode','filename']);
    if(Object.keys(target).some(k=>!allowed.has(k)))throw new DriverError('INVALID_INPUT');
    let client:SqliteAdapter;
    try{client=new SqliteAdapter(target as SqliteTarget);}
    catch{throw new DriverError('INVALID_INPUT');}
    let closed=false;
    const info:SqlDatabaseInfo=Object.freeze({
      model:'relational',engine:'sqlite',transport:'embedded',
      capabilities:Object.freeze(['sql.parameter-binding.text-numeric','sql.query.rows-bounded'] as DriverCapability[])
    });
    return {info,
      async query(sql,parameters=[]){
        if(closed)throw new DriverError('OPERATION_FAILED');
        validateSql(sql,parameters);
        try{return client.query(sql,parameters);}
        catch(e){throw checkedError(e,false);}
      },
      async close(){if(!closed){closed=true;client.close();}}
    };
  }
  throw new DriverError('UNSUPPORTED_ENGINE');
}

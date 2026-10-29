/**
 * Compile-only, strict consumer contract for the packaged driver's root.
 * A change that breaks a promised preview usage must fail CI, even if a
 * runtime JavaScript smoke test still succeeds.
 */
import {
  connectDatabase,createDatabasePool,DriverError,MysqlSession,
  type BindValue,type DatabaseTarget,type MysqlTarget,
  type SessionInfo,type MysqlColumn,type QueryResult,
  type RelationalSession,type RelationalTransaction,
  type RelationalPreparedStatement,type RelationalCursor,
  type RelationalCursorRow,type CursorOptions,
  type OperationOptions,type DatabasePool,type PoolOptions,
  type PoolStats,type PooledRelationalSession
} from '@nublox/driver';

type Equal<A,B>=
  (<T>()=>T extends A?1:2) extends
  (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true>=T;
type _ConnectArgument=Assert<Equal<Parameters<typeof connectDatabase>[0],DatabaseTarget>>;
type _ConnectResult=Assert<Equal<Awaited<ReturnType<typeof connectDatabase>>,RelationalSession>>;
type _PoolArgument=Assert<Equal<Parameters<typeof createDatabasePool>[0],DatabaseTarget>>;
type _PoolOptions=Assert<Equal<Parameters<typeof createDatabasePool>[1],PoolOptions>>;
type _PoolResult=Assert<Equal<ReturnType<typeof createDatabasePool>,DatabasePool>>;
type _TargetSecurity=Assert<Equal<MysqlTarget['security'],'verified-tls'|'isolated-local'>>;
type _Values=Assert<Equal<BindValue,null|boolean|string|number|bigint|Uint8Array>>;
type _Rows=Assert<Equal<QueryResult['rowValues'],unknown[][]|undefined>>;
type _PoolCounterKeys=Assert<Equal<keyof PoolStats,
  'size'|'idle'|'active'|'connecting'|'pending'|'created'|'discarded'|
  'expired'|'healthChecks'|'healthFailures'|'acquireTimeouts'>>;
type _DriverErrors=Assert<Equal<
  Extract<DriverError['code'],'TIMEOUT'|'TRANSACTION_OUTCOME_UNKNOWN'>,
  'TIMEOUT'|'TRANSACTION_OUTCOME_UNKNOWN'
>>;
type _ErrorSqlState=Assert<Equal<DriverError['sqlState'],string|null>>;

const target:MysqlTarget={
  engine:'mysql',host:'localhost',port:3306,user:'app',password:'redacted',
  security:'verified-tls',ca:'test-only-cert',serverName:'localhost',
  timeoutMs:3000
};
const alsoTarget:DatabaseTarget=target;
const timeout:OperationOptions={signal:new AbortController().signal,timeoutMs:5000};
const cursorOptions:CursorOptions={...timeout,fetchSize:16};
const options:PoolOptions={maxConnections:2,acquireTimeoutMs:1200,
  idleTimeoutMs:10000,healthCheckTimeoutMs:2000};
const _engine:SessionInfo['engine']='mysql';
const _model:SessionInfo['model']='relational';
const _field:Pick<MysqlColumn,'name'|'table'|'unsigned'>={
  name:'id',table:null,unsigned:false
};
const _cursorRow:RelationalCursorRow={row:{id:1n},values:[1n]};
const _runtimeClass:typeof MysqlSession=MysqlSession;
const _error=new DriverError('CONNECTION_CLOSED','redacted');

async function consumerUsage(session:RelationalSession,pool:DatabasePool,
  tx:RelationalTransaction,statement:RelationalPreparedStatement,
  cursor:RelationalCursor):Promise<void>{
  const r:QueryResult=await session.query('SELECT ? AS value',[42n],timeout);
  const sets:QueryResult[]=await session.queryResults('SELECT ?',[1],timeout);
  const prepared:RelationalPreparedStatement=await session.prepare('SELECT ?',[...[]].length?timeout:timeout);
  await prepared.execute([2],timeout);
  await prepared.executeResults([3],timeout);
  await prepared.close();
  const row:RelationalCursorRow=(await cursor.next()).value;
  const tuple:readonly unknown[]=row.values;
  await cursor.close();
  const inside:QueryResult=await tx.query('SELECT ?',[3]);
  const other:QueryResult[]=await tx.queryResults('SELECT ?',[4]);
  const elapsed=await session.withCursor('SELECT ?',[5],async iterator=>{
    let count=0;
    for await(const item of iterator)count+=item.values.length;
    return count;
  },cursorOptions);
  const inTransaction:QueryResult=await session.transaction(
    async t=>t.query('SELECT 1'),timeout);
  const p:PooledRelationalSession=await pool.withConnection(async lease=>lease);
  const value:QueryResult=await p.query('SELECT ?',[5],timeout);
  const poolInfo:Readonly<PoolStats>=pool.stats;
  const isClosed:boolean=pool.closed;
  const info:Readonly<SessionInfo>=session.info;
  void [r,sets,row,tuple,inside,other,elapsed,inTransaction,value,poolInfo,
    isClosed,info,_engine,_model,_field,_cursorRow,_runtimeClass,_error,alsoTarget];
  await pool.close();
}

// @ts-expect-error only MySQL is currently a supported target
const unsupported:DatabaseTarget={...target,engine:'postgres'};
// @ts-expect-error security modes are intentionally restricted
const insecure:MysqlTarget={...target,security:'plaintext'};
// @ts-expect-error database parameters cannot be arbitrary nested objects
const badValue:BindValue={inject:'something'};
// @ts-expect-error a bounded pool requires maxConnections
const missingPoolSize:PoolOptions={};
// @ts-expect-error cursor fetchSize cannot be a string
const invalidCursor:CursorOptions={fetchSize:'25'};
// @ts-expect-error error identifiers cannot be arbitrary strings
const arbitraryError=new DriverError('SOME_NEW_ERROR','message');
// @ts-expect-error the driver does not expose an unreviewed root symbol
import {connectPostgres} from '@nublox/driver';

void [unsupported,insecure,badValue,missingPoolSize,invalidCursor,arbitraryError,
  consumerUsage,connectPostgres,options,alsoTarget];

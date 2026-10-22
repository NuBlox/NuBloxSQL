import type {DatabaseTarget} from './contracts.js';
import {connectMysql,type MysqlSession} from '../vendors/mysql/adapter.js';
import {ConnectionPool,type PoolOptions,type DatabasePool} from './pooling.js';
import {fail} from './errors.js';
import type {RelationalSession} from '../models/relational.js';
/** Public entrypoint for the currently qualified native adapter; future vendors register here. */
export async function connectDatabase(target:DatabaseTarget):Promise<RelationalSession>{
  if(!target||target.engine!=='mysql')throw fail('UNSUPPORTED_ENGINE','Database engine is not supported');
  return connectMysql(target);
}

/** Construct a bounded native pool; connection creation is lazy. */
export function createDatabasePool(target:DatabaseTarget,options:PoolOptions):DatabasePool {
  if(!target||target.engine!=='mysql')throw fail('UNSUPPORTED_ENGINE','Database engine is not supported');
  return new ConnectionPool<MysqlSession>(()=>connectMysql(target),options);
}

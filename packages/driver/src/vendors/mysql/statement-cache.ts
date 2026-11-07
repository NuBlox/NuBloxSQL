import {fail} from '../../core/errors.js';

/** Never retain giant SQL strings in a cache: 16 * 8 KiB is a hard
 * upper bound on UTF-8 key bytes per physical connection. Bigger statements
 * still execute using the existing uncached prepared lifecycle. */
export const MAX_CACHED_SQL_BYTES=8*1024;
export function cacheableMysqlSql(sql:unknown):sql is string{
  return typeof sql==='string'&&
    Buffer.byteLength(sql,'utf8')<=MAX_CACHED_SQL_BYTES;
}

export interface CachedMysqlStatement {
  readonly id:number;
  readonly parameterCount:number;
}

/** Session-private exact-SQL LRU of server-owned handles. The caller owns
 * all COM_STMT_CLOSE I/O, including eviction and failure cleanup.
 * No SQL text, bind values or handles escape through a public API. */
export class MysqlStatementCache {
  private readonly entries=new Map<string,CachedMysqlStatement>();

  constructor(readonly capacity:number){
    if(!Number.isSafeInteger(capacity)||capacity<0||capacity>16)
      throw fail('INVALID_INPUT','MySQL statement cache must have 0–16 entries');
  }

  get size():number{return this.entries.size;}
  get(sql:string):CachedMysqlStatement|undefined{
    return this.entries.get(sql);
  }
  /** Refresh LRU only after confirmed successful execution. */
  remember(sql:string,prepared:CachedMysqlStatement):CachedMysqlStatement|undefined{
    if(this.capacity===0)
      throw fail('INVALID_INPUT','MySQL statement caching is disabled');
    this.entries.delete(sql);
    this.entries.set(sql,prepared);
    if(this.entries.size<=this.capacity)return undefined;
    return this.removeOldest();
  }
  drop(sql:string):CachedMysqlStatement|undefined{
    const item=this.entries.get(sql);
    this.entries.delete(sql);
    return item;
  }
  removeOldest():CachedMysqlStatement|undefined{
    const first=this.entries.keys().next();
    if(first.done)return undefined;
    const item=this.entries.get(first.value);
    this.entries.delete(first.value);
    return item;
  }
  clear():void{this.entries.clear();}
}

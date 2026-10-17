/** Embedded SQLite transport using Node's built-in sqlite binding.
 * Historical NuBloxSQL SQLite implementation informed the bounded result policy.
 * This is an adapter, NOT a claim to have authored the SQLite storage engine.
 */
import {DatabaseSync} from 'node:sqlite';

const MAX_ROWS=1001;
const MAX_ROW_BYTES=2*1024*1024;
const MAX_RESULT_BYTES=8*1024*1024;

export type SqliteOpenMode = 'memory'|'read-only'|'read-write-create';
export type SqliteTarget =
  | {engine:'sqlite';mode:'memory'}
  | {engine:'sqlite';mode:'read-only'|'read-write-create';filename:string};

export type SqlBoundValue = string|number;
export type SqlResult = {rows:Record<string,unknown>[]};

function rowBytes(row:Record<string,unknown>):number {
  let n=0;
  for(const [key,value] of Object.entries(row)){
    n+=Buffer.byteLength(key,'utf8');
    if(typeof value==='string') n+=Buffer.byteLength(value,'utf8');
    else if(typeof value==='bigint'||typeof value==='number'||typeof value==='boolean')n+=8;
    else if(value instanceof Uint8Array)n+=value.byteLength;
    if(n>MAX_ROW_BYTES)break;
  }
  return n;
}
function limitError(code:string):Error & {code:string} {
  const error=new Error('Native database result exceeded its configured resource budget') as Error & {code:string};
  error.code=code;return error;
}
export class SqliteAdapter {
  private closed=false;
  private readonly db:DatabaseSync;
  private readonly readonlyMode:boolean;
  constructor(target:SqliteTarget){
    if(!target||target.engine!=='sqlite')throw new TypeError('Invalid SQLite target');
    if(target.mode==='memory'){
      if('filename' in target)throw new TypeError('In-memory SQLite must not specify a filename');
      this.db=new DatabaseSync(':memory:');
      this.readonlyMode=false;
    }else if(target.mode==='read-only'||target.mode==='read-write-create'){
      if(!('filename' in target)||typeof target.filename!=='string'||
        !target.filename||target.filename.includes('\0')||
        target.filename===':memory:'||target.filename.startsWith('file:'))
        throw new TypeError('A safe SQLite file path is required');
      this.readonlyMode=target.mode==='read-only';
      this.db=new DatabaseSync(target.filename,{readOnly:this.readonlyMode});
    }else throw new TypeError('Unsupported SQLite open mode');
  }
  query(sql:string,values:readonly SqlBoundValue[]=[]):SqlResult {
    if(this.closed)throw new Error('SQLite connection is closed');
    if(typeof sql!=='string'||!sql.trim()||sql.includes('\0')||
      !Array.isArray(values)||values.length>16||
      values.some(v=>!((typeof v==='string'&&v.length<=16384)||
        (typeof v==='number'&&Number.isFinite(v)))))
      throw new TypeError('Invalid SQLite query or parameter');
    const stmt=this.db.prepare(sql);
    stmt.setReadBigInts(true);
    // A row-returning statement is distinct from a no-result command.
    // sqlite StatementSync exposes column metadata before execution.
    if(stmt.columns().length===0){
      stmt.run(...values);
      return {rows:[]};
    }
    let totalBytes=0;
    const rows:Record<string,unknown>[]=[];
    for(const row of stmt.iterate(...values)){
      if(rows.length>=MAX_ROWS)throw limitError('NUBLOX_SQLITE_MAX_ROWS');
      const copy=Object.assign(Object.create(null) as Record<string,unknown>,row);
      const size=rowBytes(copy);
      if(size>MAX_ROW_BYTES)throw limitError('NUBLOX_SQLITE_MAX_ROW_BYTES');
      totalBytes+=size;
      if(totalBytes>MAX_RESULT_BYTES)throw limitError('NUBLOX_SQLITE_MAX_RESULT_BYTES');
      rows.push(copy);
    }
    return {rows};
  }
  close():void {
    if(!this.closed){this.closed=true;this.db.close();}
  }
}

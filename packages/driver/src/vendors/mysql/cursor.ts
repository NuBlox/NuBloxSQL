import {fail} from '../../core/errors.js';
import type {MysqlColumn} from '../../core/contracts.js';
import type {RelationalCursor,RelationalCursorRow} from '../../models/relational.js';

/** Forward-only cursor with at most one native fetch batch buffered at once.
 * All COM_STMT_FETCH traffic is controlled by the owning MysqlSession. */
export class MysqlCursor implements RelationalCursor {
  readonly columns:readonly MysqlColumn[];
  readonly columnKeys:readonly string[];
  private readonly buffered:RelationalCursorRow[]=[];
  private exhausted=false;
  private invalid=false;
  private fetching=false;
  private batchIndex=0;

  constructor(
    columns:readonly MysqlColumn[],keys:readonly string[],
    private readonly fetch:()=>Promise<{rows:RelationalCursorRow[];done:boolean}>
  ){
    this.columns=Object.freeze([...columns]);
    this.columnKeys=Object.freeze([...keys]);
  }

  get closed():boolean{return this.invalid;}
  get inFlight():boolean{return this.fetching;}

  async next():Promise<IteratorResult<RelationalCursorRow>>{
    if(this.invalid)return {done:true,value:undefined};
    if(this.fetching)
      throw fail('INVALID_INPUT','Concurrent cursor reads are not permitted');
    this.fetching=true;
    try{
      if(this.batchIndex>=this.buffered.length&&!this.exhausted){
        const result=await this.fetch();
        this.buffered.length=0;
        this.batchIndex=0;
        this.buffered.push(...result.rows);
        this.exhausted=result.done;
      }
      if(this.invalid)return {done:true,value:undefined};
      if(this.batchIndex<this.buffered.length){
        return {done:false,value:this.buffered[this.batchIndex++]};
      }
      await this.close();
      return {done:true,value:undefined};
    }finally{this.fetching=false;}
  }
  [Symbol.asyncIterator]():AsyncIterableIterator<RelationalCursorRow>{return this;}

  async return():Promise<IteratorResult<RelationalCursorRow>>{
    await this.close();
    return {done:true,value:undefined};
  }

  async close():Promise<void>{
    this.invalid=true;
    this.exhausted=true;
    this.buffered.length=0;
    this.batchIndex=0;
    // COM_STMT_CLOSE and socket cleanup are completed by the owning
    // callback's finally block, never by a concurrent iterator action.
  }

  invalidate():void{void this.close();}
}

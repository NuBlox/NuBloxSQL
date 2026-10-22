import {fail} from './errors.js';
import {validDeadline,type OperationOptions} from './resources.js';
import type {RelationalSession,RelationalTransaction} from '../models/relational.js';
import type {BindValue,QueryResult,SessionInfo} from './contracts.js';

export interface PoolOptions {
  /** Maximum simultaneously open or connecting native sessions (1–32). */
  readonly maxConnections:number;
  /** Maximum time in milliseconds to wait for a free pool slot (100–120000). */
  readonly acquireTimeoutMs?:number;
}

/** A borrowed view. No direct close/reset operation can bypass the pool. */
export interface PooledRelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
}
export interface PoolStats {
  readonly size:number;
  readonly idle:number;
  readonly pending:number;
}
export interface DatabasePool {
  readonly closed:boolean;
  readonly stats:Readonly<PoolStats>;
  withConnection<T>(work:(session:PooledRelationalSession)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
export interface PoolSession extends RelationalSession {
  /** Adapter-private reset; must clear transaction, prepared and session state. */
  resetForPool():Promise<void>;
}
type Waiter<S>={resolve:(session:S)=>void;reject:(reason:unknown)=>void;timer:NodeJS.Timeout};

export class ConnectionPool<S extends PoolSession> implements DatabasePool {
  private readonly idle:S[]=[];
  private readonly sessions=new Set<S>();
  private readonly pending:Waiter<S>[]=[];
  private sizeCount=0;
  private stopped=false;
  private readonly max:number;
  private readonly acquireMs:number;

  constructor(private readonly connect:()=>Promise<S>,options:PoolOptions) {
    if(!options||typeof options!=='object'||!Number.isInteger(options.maxConnections)||
      options.maxConnections<1||options.maxConnections>32)
      throw fail('INVALID_INPUT','Pool maxConnections must be an integer from 1 to 32');
    const ms=options.acquireTimeoutMs??15000;
    if(!validDeadline(ms))
      throw fail('INVALID_INPUT','Pool acquireTimeoutMs must be between 100 and 120000');
    this.max=options.maxConnections;
    this.acquireMs=ms;
  }
  get closed():boolean{return this.stopped;}
  get stats():Readonly<PoolStats>{
    return Object.freeze({size:this.sizeCount,idle:this.idle.length,pending:this.pending.length});
  }

  private dispatch():void {
    if(this.stopped)return;
    while(this.pending.length){
      while(this.idle.length&&this.idle[this.idle.length-1].closed) {
        const dead=this.idle.pop()!;
        this.sessions.delete(dead);
        this.sizeCount--;
      }
      if(this.idle.length){
        const waiter=this.pending.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(this.idle.pop()!);
        continue;
      }
      if(this.sizeCount>=this.max)break;
      const waiter=this.pending.shift()!;
      clearTimeout(waiter.timer);
      this.sizeCount++;
      void this.connect().then(session=>{
        if(this.stopped){
          this.sizeCount--;
          void session.close();
          waiter.reject(fail('CONNECTION_CLOSED','Pool is closed'));
          return;
        }
        this.sessions.add(session);
        waiter.resolve(session);
      },error=>{
        this.sizeCount--;
        waiter.reject(error);
        this.dispatch();
      });
    }
  }

  private acquire():Promise<S>{
    if(this.stopped)return Promise.reject(fail('CONNECTION_CLOSED','Pool is closed'));
    if(this.pending.length>=1024)
      return Promise.reject(fail('RESOURCE_LIMIT','Too many pending pool acquisitions'));
    return new Promise<S>((resolve,reject)=>{
      const waiter:Waiter<S>={
        resolve,reject,
        timer:setTimeout(()=>{
          const pos=this.pending.indexOf(waiter);
          if(pos<0)return; // already assigned a free slot or started connecting
          this.pending.splice(pos,1);
          reject(fail('TIMEOUT','Pool acquisition timed out'));
        },this.acquireMs)
      };
      this.pending.push(waiter);
      this.dispatch();
    });
  }

  private async release(session:S,reusable:boolean):Promise<void>{
    if(!this.sessions.has(session))return; // close() already disposed the lease
    if(this.stopped||!reusable||session.closed){
      await this.discard(session);
      return;
    }
    try{
      await session.resetForPool();
      if(this.stopped||session.closed){
        await this.discard(session);
        return;
      }
      this.idle.push(session);
      this.dispatch();
    }catch{
      await this.discard(session);
      throw fail('CONNECTION_FAILED','Pooled connection reset failed; connection discarded');
    }
  }

  private async discard(session:S):Promise<void>{
    if(this.sessions.delete(session))this.sizeCount--;
    try{await session.close();}finally{this.dispatch();}
  }

  async withConnection<T>(work:(session:PooledRelationalSession)=>Promise<T>):Promise<T>{
    if(typeof work!=='function')throw fail('INVALID_INPUT','Pool callback must be a function');
    const session=await this.acquire();
    let valid=true;
    const pending=new Set<Promise<unknown>>();
    const guard=():void=>{
      if(!valid||this.stopped||session.closed)
        throw fail('CONNECTION_CLOSED','Pooled session lease is no longer valid');
    };
    const track=<R>(operation:()=>Promise<R>):Promise<R>=>{
      try{guard();}catch(error){return Promise.reject(error);}
      const promise=Promise.resolve().then(()=>{guard();return operation();});
      pending.add(promise);
      void promise.then(()=>{pending.delete(promise);},()=>{pending.delete(promise);});
      return promise;
    };
    const lease:PooledRelationalSession=Object.freeze({
      get info(){return session.info;},
      get closed(){return !valid||session.closed;},
      query:(sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={})=>
        track(()=>session.query(sql,parameters,options)),
      transaction:<R>(callback:(transaction:RelationalTransaction)=>Promise<R>,options:OperationOptions={})=>
        track(()=>session.transaction<R>(callback,options))
    });

    let succeeded=false;
    try{
      const result=await work(lease);
      succeeded=true;
      return result;
    }finally{
      valid=false; // future calls through escaped lease are rejected
      // A callback must await every operation it initiates; never hand a
      // connection back while unobserved work might still be executing.
      const reusable=succeeded&&pending.size===0&&!session.closed;
      await this.release(session,reusable);
    }
  }

  async close():Promise<void>{
    if(this.stopped)return;
    this.stopped=true;
    for(const waiter of this.pending.splice(0)){
      clearTimeout(waiter.timer);
      waiter.reject(fail('CONNECTION_CLOSED','Pool is closed'));
    }
    this.idle.length=0;
    const live=[...this.sessions];
    this.sessions.clear();
    this.sizeCount-=live.length; // connecting slots remain until their connect promise settles
    // close() interrupts native operations instead of awaiting arbitrary app callbacks.
    await Promise.all(live.map(session=>session.close()));
  }
}

import {fail} from './errors.js';
import {validDeadline,type OperationOptions} from './resources.js';
import type {RelationalSession,RelationalTransaction,RelationalPreparedStatement} from '../models/relational.js';
import type {BindValue,QueryResult,SessionInfo} from './contracts.js';

export interface PoolOptions {
  /** Maximum open or connecting sessions, from 1 to 32. */
  readonly maxConnections:number;
  /** Wait for a free slot, from 100 to 120000 milliseconds. */
  readonly acquireTimeoutMs?:number;
  /** Close unused native sessions after 100–3600000 ms (default: 60000). */
  readonly idleTimeoutMs?:number;
  /** Native protocol health probe deadline, 100–120000 ms (default: 1500). */
  readonly healthCheckTimeoutMs?:number;
}
export interface PooledRelationalSession {
  readonly info:Readonly<SessionInfo>;
  readonly closed:boolean;
  query(sql:string,parameters?:readonly BindValue[],options?:OperationOptions):Promise<QueryResult>;
  prepare(sql:string,options?:OperationOptions):Promise<RelationalPreparedStatement>;
  transaction<T>(work:(transaction:RelationalTransaction)=>Promise<T>,options?:OperationOptions):Promise<T>;
}
export interface PoolStats {
  /** Open or connecting slots, never exceeding maxConnections. */
  readonly size:number;
  readonly idle:number;
  readonly active:number;
  readonly connecting:number;
  readonly pending:number;
  /** Monotonic diagnostic counters since pool creation. */
  readonly created:number;
  readonly discarded:number;
  readonly expired:number;
  readonly healthChecks:number;
  readonly healthFailures:number;
  readonly acquireTimeouts:number;
}
export interface DatabasePool {
  readonly closed:boolean;
  readonly stats:Readonly<PoolStats>;
  withConnection<T>(work:(session:PooledRelationalSession)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
export interface PoolSession extends RelationalSession {
  /** Vendor-owned non-destructive health check, e.g. MySQL COM_PING. */
  healthCheckForPool(timeoutMs:number):Promise<void>;
  /** Vendor-owned reset of transactions, variables and prepared statements. */
  resetForPool():Promise<void>;
}
type Waiter<S>={resolve:(session:S)=>void;reject:(reason:unknown)=>void;timer:NodeJS.Timeout};
type IdleEntry<S>={session:S;expiresAt:number;timer:NodeJS.Timeout};

/**
 * Bounded FIFO pooling that never replays SQL. Connection replacement is
 * allowed ONLY before application work starts, and at most once per lease.
 */
export class ConnectionPool<S extends PoolSession> implements DatabasePool {
  private readonly idle:IdleEntry<S>[]=[];
  private readonly sessions=new Set<S>();
  private readonly pending:Waiter<S>[]=[];
  private sizeCount=0;
  private connectingCount=0;
  private stopped=false;
  private readonly max:number;
  private readonly acquireMs:number;
  private readonly idleMs:number;
  private readonly healthMs:number;
  private created=0;
  private discarded=0;
  private expired=0;
  private healthChecks=0;
  private healthFailures=0;
  private acquireTimeouts=0;

  constructor(private readonly connect:()=>Promise<S>,options:PoolOptions) {
    if(!options||typeof options!=='object'||!Number.isInteger(options.maxConnections)||
      options.maxConnections<1||options.maxConnections>32)
      throw fail('INVALID_INPUT','Pool maxConnections must be an integer from 1 to 32');
    const acquireMs=options.acquireTimeoutMs??15000;
    const idleMs=options.idleTimeoutMs??60000;
    const healthMs=options.healthCheckTimeoutMs??1500;
    if(!validDeadline(acquireMs))
      throw fail('INVALID_INPUT','Invalid pool acquisition timeout');
    if(!Number.isSafeInteger(idleMs)||idleMs<100||idleMs>3_600_000)
      throw fail('INVALID_INPUT','Invalid pool idle timeout');
    if(!validDeadline(healthMs))
      throw fail('INVALID_INPUT','Invalid pool health-check timeout');
    this.max=options.maxConnections;
    this.acquireMs=acquireMs;
    this.idleMs=idleMs;
    this.healthMs=healthMs;
  }
  get closed():boolean{return this.stopped;}
  get stats():Readonly<PoolStats>{
    return Object.freeze({
      size:this.sizeCount,idle:this.idle.length,
      active:this.sessions.size-this.idle.length,
      connecting:this.connectingCount,pending:this.pending.length,
      created:this.created,discarded:this.discarded,expired:this.expired,
      healthChecks:this.healthChecks,healthFailures:this.healthFailures,
      acquireTimeouts:this.acquireTimeouts
    });
  }

  private takeIdle():S|undefined {
    while(this.idle.length){
      const entry=this.idle.pop()!;
      clearTimeout(entry.timer);
      if(entry.session.closed||entry.expiresAt<=Date.now()){
        if(entry.expiresAt<=Date.now())this.expired++;
        void this.discardSession(entry.session);
        continue;
      }
      return entry.session;
    }
    return undefined;
  }
  private park(session:S):void {
    const entry:IdleEntry<S>={
      session,expiresAt:Date.now()+this.idleMs,
      timer:setTimeout(()=>{
        const index=this.idle.indexOf(entry);
        if(index<0)return;
        this.idle.splice(index,1);
        this.expired++;
        void this.discardSession(session);
      },this.idleMs)
    };
    entry.timer.unref();
    this.idle.push(entry);
  }
  private dispatch():void {
    if(this.stopped)return;
    while(this.pending.length){
      const idle=this.takeIdle();
      if(idle){
        const waiter=this.pending.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(idle);
        continue;
      }
      if(this.sizeCount>=this.max)break;
      const waiter=this.pending.shift()!;
      clearTimeout(waiter.timer);
      this.sizeCount++;
      this.connectingCount++;
      void Promise.resolve().then(()=>this.connect()).then(session=>{
        this.connectingCount--;
        if(this.stopped){
          this.sizeCount--;
          void session.close();
          waiter.reject(fail('CONNECTION_CLOSED','Pool is closed'));
          return;
        }
        this.sessions.add(session);
        this.created++;
        waiter.resolve(session);
      },error=>{
        this.connectingCount--;
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
          const index=this.pending.indexOf(waiter);
          if(index<0)return;
          this.pending.splice(index,1);
          this.acquireTimeouts++;
          reject(fail('TIMEOUT','Pool acquisition timed out'));
        },this.acquireMs)
      };
      this.pending.push(waiter);
      this.dispatch();
    });
  }
  private async discardSession(session:S):Promise<void>{
    if(this.sessions.delete(session)){
      this.sizeCount--;
      this.discarded++;
    }
    try{await session.close();}finally{this.dispatch();}
  }
  private async release(session:S,reusable:boolean):Promise<void>{
    if(!this.sessions.has(session))return;
    if(this.stopped||!reusable||session.closed){
      await this.discardSession(session);
      return;
    }
    try{
      await session.resetForPool();
      if(this.stopped||session.closed){
        await this.discardSession(session);
        return;
      }
      this.park(session);
      this.dispatch();
    }catch{
      await this.discardSession(session);
      throw fail('CONNECTION_FAILED','Pooled connection reset failed; connection discarded');
    }
  }

  async withConnection<T>(work:(session:PooledRelationalSession)=>Promise<T>):Promise<T>{
    if(typeof work!=='function')throw fail('INVALID_INPUT','Pool callback must be a function');
    let session:S|undefined;
    // A health check is never an application query. Retry only checkout once;
    // never retry application SQL or an ambiguous transaction automatically.
    for(let attempt=0;attempt<2;attempt++){
      const candidate=await this.acquire();
      try{
        this.healthChecks++;
        await candidate.healthCheckForPool(this.healthMs);
        if(this.stopped||candidate.closed)
          throw fail('CONNECTION_CLOSED','Pooled connection closed during health check');
        session=candidate;
        break;
      }catch(error){
        this.healthFailures++;
        await this.discardSession(candidate);
        if(this.stopped)throw fail('CONNECTION_CLOSED','Pool is closed');
        if(attempt===1)throw fail('CONNECTION_FAILED','Database connection failed pool health checks');
      }
    }
    if(!session)throw fail('CONNECTION_FAILED','Database pool cannot provide a healthy connection');
    const activeSession=session;
    let valid=true;
    const pending=new Set<Promise<unknown>>();
    const guard=():void=>{
      if(!valid||this.stopped||activeSession.closed)
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
      get info(){return activeSession.info;},
      get closed(){return !valid||activeSession.closed;},
      query:(sql:string,parameters:readonly BindValue[]=[],options:OperationOptions={})=>
        track(()=>activeSession.query(sql,parameters,options)),
      prepare:(sql:string,options:OperationOptions={})=>track(async()=>{
        const raw=await activeSession.prepare(sql,options);
        const handle:RelationalPreparedStatement=Object.freeze({
          get parameterCount(){return raw.parameterCount;},
          get closed(){return !valid||raw.closed;},
          execute:(params:readonly BindValue[]=[],opts:OperationOptions={})=>
            track(()=>raw.execute(params,opts)),
          close:()=>track(()=>raw.close())
        });
        return handle;
      }),
      transaction:<R>(callback:(transaction:RelationalTransaction)=>Promise<R>,options:OperationOptions={})=>
        track(()=>activeSession.transaction<R>(callback,options))
    });
    let succeeded=false;
    try{
      const result=await work(lease);
      succeeded=true;
      return result;
    }finally{
      valid=false;
      const reusable=succeeded&&pending.size===0&&!activeSession.closed;
      await this.release(activeSession,reusable);
    }
  }

  async close():Promise<void>{
    if(this.stopped)return;
    this.stopped=true;
    for(const waiter of this.pending.splice(0)){
      clearTimeout(waiter.timer);
      waiter.reject(fail('CONNECTION_CLOSED','Pool is closed'));
    }
    for(const entry of this.idle)clearTimeout(entry.timer);
    this.idle.length=0;
    const live=[...this.sessions];
    this.sessions.clear();
    this.sizeCount-=live.length; // outstanding connects decrement when they settle
    this.discarded+=live.length;
    await Promise.all(live.map(session=>session.close()));
  }
}

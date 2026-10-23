import {fail,type DriverError} from './errors.js';

/** An operation deadline starts when its command obtains the session, not while queued. */
export interface OperationOptions {
  readonly signal?:AbortSignal;
  readonly timeoutMs?:number;
}
/** Bounded logical MySQL message, not the 24-bit frame size. */
export const MAX_PACKET_BYTES=32*1024*1024;
export const MAX_RESULT_ROWS=10_000;
/** Total result sets from one prepared execution (including final OK). */
export const MAX_RESULT_SETS=32;
export const MAX_COLUMNS=4096;
export const MAX_PARAMETERS=64;
/** Per-connection cap, independent of the server-wide prepared statement limit. */
export const MAX_PREPARED_STATEMENTS=128;
export function validDeadline(ms:number):boolean {
  return Number.isSafeInteger(ms)&&ms>=100&&ms<=120_000;
}
export function operationOptions(options:OperationOptions,defaultTimeout:number):{
  signal:AbortSignal|undefined;timeoutMs:number
}{
  if(!options||typeof options!=='object')
    throw fail('INVALID_INPUT','Invalid operation options');
  const timeoutMs=options.timeoutMs??defaultTimeout;
  if(!validDeadline(timeoutMs))
    throw fail('INVALID_INPUT','Invalid operation deadline');
  const signal=options.signal;
  if(signal!==undefined&&(
    typeof signal.aborted!=='boolean'||
    typeof signal.addEventListener!=='function'||
    typeof signal.removeEventListener!=='function'))
    throw fail('INVALID_INPUT','Invalid cancellation signal');
  return {signal,timeoutMs};
}

/** A single active operation. Interruption closes the underlying connection to prevent
 * reuse of a potentially desynchronised native database protocol session. */
export class OperationGuard {
  readonly interrupted:Promise<never>;
  private reject!: (error:DriverError)=>void;
  private timer:NodeJS.Timeout;
  private readonly onAbort=():void=>
    this.interrupt(fail('CANCELLED','Database operation cancelled'));
  private stopped=false;

  constructor(
    timeoutMs:number,
    private readonly signal:AbortSignal|undefined,
    private readonly onInterrupt:()=>void
  ){
    this.interrupted=new Promise<never>((_,reject)=>{this.reject=reject;});
    this.signal?.addEventListener('abort',this.onAbort,{once:true});
    this.timer=setTimeout(
      ()=>this.interrupt(fail('TIMEOUT','Database operation timed out')),
      timeoutMs
    );
    if(signal?.aborted)this.onAbort();
  }
  interrupt(error:DriverError):void {
    if(this.stopped)return;
    this.stopped=true;
    // Reject the operation before disposing the network; network exceptions
    // must not hide the original CANCELLED or TIMEOUT outcome.
    this.reject(error);
    this.onInterrupt();
  }
  dispose():void {
    this.stopped=true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort',this.onAbort);
  }
}

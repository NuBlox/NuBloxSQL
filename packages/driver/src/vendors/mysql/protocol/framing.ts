import type {Socket} from 'node:net';
import {LIMIT} from './primitives.js';
import {DriverError,fail} from '../../../core/errors.js';

export const MAX_FRAME_PAYLOAD=0xffffff;
const MAX_QUEUED_MESSAGES=1024;
/** Avoid two asynchronous socket writes for ordinary small Classic commands. */
const INLINE_FRAME_BYTES=4096;

type Waiter={resolve:(body:Buffer)=>void;reject:(error:Error)=>void};

/** Incremental MySQL Classic frame codec. An application message can span
 * multiple 24-bit frames; a full-sized final frame requires an empty trailer.
 * Sequence numbers are shared by both directions of the current exchange. */
export class PacketStream {
  private socket:Socket|null=null;
  private readonly queue:Buffer[]=[];
  private readonly waiters:Waiter[]=[];
  private queuedBytes=0;
  private sequence=0;
  private failure:Error|null=null;
  private fatalListener:((error:Error)=>void)|null=null;

  private readonly header=Buffer.alloc(4);
  private headerRead=0;
  private frameRemaining=-1;
  private readonly fragments:Buffer[]=[];
  private logicalBytes=0;

  private readonly onData=(chunk:Buffer):void=>this.feed(chunk);
  private readonly onError=(error:Error):void=>this.abort(error);
  private readonly onEnd=():void=>this.abort(new Error('Database connection closed'));

  constructor(socket:Socket){this.attach(socket);}

  /** The authenticated owner must be invalidated immediately on loss of its
   * transport, including idle disconnects with no pending read waiter. */
  onFatal(listener:(error:Error)=>void):void {
    this.fatalListener=listener;
    if(this.failure)listener(this.failure);
  }

  /** Detach during STARTTLS, then attach the authenticated TLS socket. */
  attach(socket:Socket):void {
    this.detach();
    if(this.failure)throw this.failure;
    this.socket=socket;
    socket.on('data',this.onData);
    socket.on('error',this.onError);
    socket.on('end',this.onEnd);
    socket.on('close',this.onEnd);
  }
  detach():void {
    if(!this.socket)return;
    this.socket.off('data',this.onData);
    this.socket.off('error',this.onError);
    this.socket.off('end',this.onEnd);
    this.socket.off('close',this.onEnd);
    this.socket=null;
  }
  reset():void {
    if(this.failure)throw this.failure;
    if(this.queue.length||this.headerRead||this.frameRemaining!==-1||this.logicalBytes)
      throw new Error('Unexpected unread MySQL traffic');
    this.sequence=0;
  }

  private finish():void {
    const body=this.fragments.length===1?this.fragments[0]:
      Buffer.concat(this.fragments,this.logicalBytes);
    this.fragments.length=0;
    this.logicalBytes=0;
    if(this.waiters.length)this.waiters.shift()!.resolve(body);
    else {
      this.queue.push(body);
      this.queuedBytes+=body.length;
      if(this.queue.length>MAX_QUEUED_MESSAGES||this.queuedBytes>LIMIT)
        throw fail('RESOURCE_LIMIT','Queued MySQL messages exceeded limit');
    }
  }

  /** Parse without repeatedly copying growing multi-megabyte TCP buffers.
   * Keep only bounded subarray references until one logical message completes. */
  private feed(chunk:Buffer):void {
    if(this.failure)return;
    try {
      let offset=0;
      while(offset<chunk.length||this.frameRemaining===0){
        if(this.frameRemaining===-1){
          let seq:number;
          let length:number;
          if(this.headerRead===0&&chunk.length-offset>=4){
            // Most TCP deliveries contain an entire 4-byte frame header.
            // Parse directly from the existing chunk: avoid copying every
            // header into scratch memory on this common path. Keep the
            // scratch buffer for headers split across TCP data events.
            length=chunk[offset]|(chunk[offset+1]<<8)|(chunk[offset+2]<<16);
            seq=chunk[offset+3];
            offset+=4;
          }else{
            const take=Math.min(4-this.headerRead,chunk.length-offset);
            chunk.copy(this.header,this.headerRead,offset,offset+take);
            offset+=take;
            this.headerRead+=take;
            if(this.headerRead<4)break;
            seq=this.header[3];
            length=this.header[0]|(this.header[1]<<8)|(this.header[2]<<16);
            this.headerRead=0;
          }
          if(seq!==this.sequence)throw Error('MySQL packet sequence mismatch');
          this.sequence=(this.sequence+1)&255;
          this.frameRemaining=length;
          this.currentFrameLength=length;
          // The advertised frame length is a lower bound on the bytes we
          // would have to retain, even if the peer never sends its payload.
          // Reject impossible messages at the header rather than permitting
          // a stalled peer to hold the connection and its partial results.
          if(this.queuedBytes+this.logicalBytes+this.frameRemaining>LIMIT)
            throw fail('RESOURCE_LIMIT','MySQL incoming logical packet exceeded limit');
        }
        const size=this.frameRemaining;
        if(size===0){
          this.frameRemaining=-1;
          this.finish();
          continue;
        }
        const take=Math.min(this.frameRemaining,chunk.length-offset);
        if(take){
          if(this.queuedBytes+this.logicalBytes+take>LIMIT)
            throw fail('RESOURCE_LIMIT','MySQL incoming logical packet exceeded limit');
          this.fragments.push(chunk.subarray(offset,offset+take));
          this.logicalBytes+=take;
          this.frameRemaining-=take;
          offset+=take;
        }
        if(this.frameRemaining===0){
          this.frameRemaining=-1;
          // A maximum-size frame must be followed by another frame, even
          // when that final frame is zero bytes long.
          if(this.currentFrameLength<MAX_FRAME_PAYLOAD)this.finish();
        }
      }
    }catch(error){
      this.abort(error instanceof DriverError?error:
        fail('PROTOCOL_ERROR','Malformed MySQL Classic packet framing'));
    }
  }

  // Tracks the 24-bit length across multiple TCP data events.
  private currentFrameLength=0;

  abort(error:Error):void {
    if(this.failure)return;
    this.failure=error;
    this.fragments.length=0;
    this.logicalBytes=0;
    this.queue.length=0;
    this.queuedBytes=0;
    for(const waiter of this.waiters.splice(0))waiter.reject(error);
    this.fatalListener?.(error);
  }
  async read():Promise<Buffer> {
    if(this.failure)throw this.failure;
    if(this.queue.length){
      const body=this.queue.shift()!;
      this.queuedBytes-=body.length;
      return body;
    }
    return new Promise<Buffer>((resolve,reject)=>this.waiters.push({resolve,reject}));
  }
  async send(body:Buffer):Promise<void> {
    if(this.failure)throw this.failure;
    if(body.length>LIMIT)throw new RangeError('MySQL outbound logical packet exceeded limit');
    const socket=this.socket;
    if(!socket)throw new Error('MySQL packet stream has no attached socket');
    let offset=0;
    try{
      do {
      // A socket may close while an earlier write callback is pending.
      // Never emit another frame after that transport has failed.
      if(this.failure)throw this.failure;
      const length=Math.min(MAX_FRAME_PAYLOAD,body.length-offset);
      const header=Buffer.allocUnsafe(4);
      header[0]=length&255;header[1]=(length>>8)&255;
      header[2]=(length>>16)&255;header[3]=this.sequence;
      this.sequence=(this.sequence+1)&255;
      if(length<=INLINE_FRAME_BYTES){
        // One socket write for small commands avoids a second callback and
        // microtask hop. Only copy a bounded payload; large frames remain
        // zero-copy slices and retain their existing backpressure behaviour.
        const frame=Buffer.allocUnsafe(4+length);
        header.copy(frame);
        if(length)body.copy(frame,4,offset,offset+length);
        await new Promise<void>((resolve,reject)=>
          socket.write(frame,error=>error?reject(error):resolve()));
      }else{
        await new Promise<void>((resolve,reject)=>
          socket.write(header,error=>error?reject(error):resolve()));
        // A successful header write alone does not prove that the socket
        // survived; check before transmitting this frame's payload.
        if(this.failure)throw this.failure;
        await new Promise<void>((resolve,reject)=>
          socket.write(body.subarray(offset,offset+length),
            error=>error?reject(error):resolve()));
      }
      if(this.failure)throw this.failure;
      offset+=length;
      if(length<MAX_FRAME_PAYLOAD)break;
      }while(true);
    }catch{
      // The peer might have received a partial command. A failed outbound
      // write irrevocably desynchronises this Classic exchange, even if the
      // socket never emits an 'error' event. Redact transport exceptions.
      const error=this.failure??fail('CONNECTION_CLOSED',
        'Native MySQL transport failed during write');
      this.abort(error);
      socket.destroy();
      throw error;
    }
  }
  destroy():void {
    const socket=this.socket;
    this.abort(new Error('Connection closed'));
    this.detach();
    socket?.destroy();
  }
}

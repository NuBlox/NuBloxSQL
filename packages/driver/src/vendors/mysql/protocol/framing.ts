import type {Socket} from 'node:net';
import {LIMIT} from './primitives.js';

export const MAX_FRAME_PAYLOAD=0xffffff;
const MAX_QUEUED_MESSAGES=1024;

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

  private readonly header=Buffer.alloc(4);
  private headerRead=0;
  private frameRemaining=-1;
  private readonly fragments:Buffer[]=[];
  private logicalBytes=0;

  private readonly onData=(chunk:Buffer):void=>this.feed(chunk);
  private readonly onError=(error:Error):void=>this.abort(error);
  private readonly onEnd=():void=>this.abort(new Error('Database connection closed'));

  constructor(socket:Socket){this.attach(socket);}

  /** Detach during STARTTLS, then attach the authenticated TLS socket. */
  attach(socket:Socket):void {
    this.detach();
    if(this.failure)throw this.failure;
    this.socket=socket;
    socket.on('data',this.onData);
    socket.on('error',this.onError);
    socket.on('close',this.onEnd);
  }
  detach():void {
    if(!this.socket)return;
    this.socket.off('data',this.onData);
    this.socket.off('error',this.onError);
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
      if(this.queue.length>MAX_QUEUED_MESSAGES)
        throw new Error('Too many queued MySQL packets');
    }
  }

  /** Parse without repeatedly copying growing multi-megabyte TCP buffers.
   * Keep only bounded subarray references until one logical message completes. */
  private feed(chunk:Buffer):void {
    if(this.failure)return;
    try {
      let offset=0;
      while(offset<chunk.length){
        if(this.frameRemaining===-1){
          const take=Math.min(4-this.headerRead,chunk.length-offset);
          chunk.copy(this.header,this.headerRead,offset,offset+take);
          offset+=take;
          this.headerRead+=take;
          if(this.headerRead<4)break;
          const seq=this.header[3];
          if(seq!==this.sequence)throw Error('MySQL packet sequence mismatch');
          this.sequence=(this.sequence+1)&255;
          this.frameRemaining=this.header[0]|(this.header[1]<<8)|(this.header[2]<<16);
          this.currentFrameLength=this.frameRemaining;
          this.headerRead=0;
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
            throw Error('MySQL incoming logical packet exceeded limit');
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
    }catch(error){this.abort(error instanceof Error?error:new Error('Invalid MySQL packet'));}
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
    do {
      const length=Math.min(MAX_FRAME_PAYLOAD,body.length-offset);
      const header=Buffer.allocUnsafe(4);
      header[0]=length&255;header[1]=(length>>8)&255;
      header[2]=(length>>16)&255;header[3]=this.sequence;
      this.sequence=(this.sequence+1)&255;
      // No concatenation of the full payload is necessary; the header and
      // slice are separately written with Node's TCP backpressure callbacks.
      await new Promise<void>((resolve,reject)=>
        socket.write(header,error=>error?reject(error):resolve()));
      if(length){
        await new Promise<void>((resolve,reject)=>
          socket.write(body.subarray(offset,offset+length),error=>error?reject(error):resolve()));
      }
      offset+=length;
      if(length<MAX_FRAME_PAYLOAD)break;
    }while(true);
  }
  destroy():void {
    const socket=this.socket;
    this.abort(new Error('Connection closed'));
    this.detach();
    socket?.destroy();
  }
}

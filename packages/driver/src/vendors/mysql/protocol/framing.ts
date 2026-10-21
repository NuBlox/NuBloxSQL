import type {Socket} from 'node:net';
import {LIMIT} from './primitives.js';

type Packet = {seq:number;body:Buffer};
type Waiter = {resolve:(packet:Packet)=>void;reject:(error:Error)=>void};

/**
 * Incremental MySQL Classic packet framing.
 * Packet sequence numbers span both sides of an exchange and reset between commands.
 * Only one native command may be active on this stream at once.
 */
export class PacketStream {
  private socket:Socket|null=null;
  private buffer:Buffer=Buffer.alloc(0);
  private readonly queue:Packet[]=[];
  private readonly waiters:Waiter[]=[];
  private queuedBytes=0;
  private sequence=0;
  private failure:Error|null=null;

  private readonly onData=(chunk:Buffer):void=>this.feed(chunk);
  private readonly onError=(error:Error):void=>this.abort(error);
  private readonly onEnd=():void=>this.abort(new Error('Database connection closed'));

  constructor(socket:Socket){this.attach(socket);}

  /** Used for upgrading the existing TCP transport to verified TLS. */
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
    if(this.queue.length||this.buffer.length)throw new Error('Unexpected unread MySQL traffic');
    this.sequence=0;
  }
  private feed(chunk:Buffer):void {
    if(this.failure)return;
    try {
      // Bound the complete outstanding input, not just the current TCP fragment.
      if(this.queuedBytes+this.buffer.length+chunk.length>LIMIT+4)
        throw new Error('MySQL incoming buffer exceeded limit');
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(this.buffer.length>=4){
        const length=this.buffer[0]|(this.buffer[1]<<8)|(this.buffer[2]<<16);
        if(length>LIMIT)throw new Error('Oversized MySQL frame');
        if(this.buffer.length<length+4)break;
        const packet:Packet={seq:this.buffer[3],body:this.buffer.subarray(4,4+length)};
        this.buffer=this.buffer.subarray(length+4);
        if(this.waiters.length)this.waiters.shift()!.resolve(packet);
        else {this.queue.push(packet);this.queuedBytes+=packet.body.length+4;}
        if(this.queue.length>1024)throw new Error('Too many queued MySQL packets');
      }
    } catch(error){this.abort(error instanceof Error?error:new Error('Invalid MySQL packet'));}
  }
  abort(error:Error):void {
    if(this.failure)return;
    this.failure=error;
    this.buffer=Buffer.alloc(0);
    this.queue.length=0;
    this.queuedBytes=0;
    for(const waiter of this.waiters.splice(0))waiter.reject(error);
  }
  async read():Promise<Buffer> {
    if(this.failure)throw this.failure;
    let packet:Packet;
    if(this.queue.length){
      packet=this.queue.shift()!;
      this.queuedBytes-=packet.body.length+4;
    } else packet=await new Promise<Packet>((resolve,reject)=>this.waiters.push({resolve,reject}));
    if(packet.seq!==this.sequence){
      this.abort(new Error('MySQL packet sequence mismatch'));
      throw this.failure;
    }
    this.sequence=(this.sequence+1)&255;
    return packet.body;
  }
  async send(body:Buffer):Promise<void> {
    if(this.failure)throw this.failure;
    if(body.length>LIMIT)throw new RangeError('MySQL outbound packet too large');
    const socket=this.socket;
    if(!socket)throw new Error('MySQL packet stream has no attached socket');
    const header=Buffer.allocUnsafe(4);
    header[0]=body.length&255;header[1]=(body.length>>8)&255;
    header[2]=(body.length>>16)&255;header[3]=this.sequence;
    this.sequence=(this.sequence+1)&255;
    await new Promise<void>((resolve,reject)=>socket.write(Buffer.concat([header,body]),error=>error?reject(error):resolve()));
  }
  destroy():void {
    const socket=this.socket;
    this.abort(new Error('Connection closed'));
    this.detach();
    socket?.destroy();
  }
}

// @ts-nocheck
import {LIMIT} from './primitives.js';
// The sequence number spans client and server packet exchange, resetting per command.
export class PacketStream {
 constructor(socket){this.socket=null;this.buffer=Buffer.alloc(0);this.queue=[];this.waiters=[];this.sequence=0;this.failure=null;this._onData=c=>this._feed(c);this._onError=e=>this.abort(e);this._onEnd=()=>this.abort(Error('Database connection closed'));this.attach(socket);}
 attach(socket){if(this.socket){this.socket.off('data',this._onData);this.socket.off('error',this._onError);this.socket.off('close',this._onEnd);}this.socket=socket;socket.on('data',this._onData);socket.on('error',this._onError);socket.on('close',this._onEnd);}
 reset(){if(this.queue.length||this.buffer.length)throw Error('Unexpected unread MySQL traffic');this.sequence=0;}
 _feed(chunk){try{if(this.failure)return;this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>LIMIT+4)throw Error('MySQL incoming buffer exceeded limit');while(this.buffer.length>=4){const length=this.buffer[0]|(this.buffer[1]<<8)|(this.buffer[2]<<16);if(length>LIMIT)throw Error('Oversized MySQL frame');if(this.buffer.length<length+4)break;const seq=this.buffer[3],body=this.buffer.subarray(4,4+length);this.buffer=this.buffer.subarray(4+length);if(this.waiters.length)this.waiters.shift().resolve({seq,body});else this.queue.push({seq,body});if(this.queue.length>1024)throw Error('Too many queued MySQL packets');}}catch(e){this.abort(e);}}
 abort(error){if(this.failure)return;this.failure=error;for(const w of this.waiters.splice(0))w.reject(error);}
 async read(){if(this.failure)throw this.failure;const next=this.queue.length?this.queue.shift():await new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));if(next.seq!==this.sequence){this.abort(Error('MySQL packet sequence mismatch'));throw this.failure;}this.sequence=(this.sequence+1)&255;return next.body;}
 async send(body){if(this.failure)throw this.failure;if(body.length>LIMIT)throw RangeError('MySQL outbound packet too large');const head=Buffer.allocUnsafe(4);head[0]=body.length&255;head[1]=(body.length>>8)&255;head[2]=(body.length>>16)&255;head[3]=this.sequence;this.sequence=(this.sequence+1)&255;await new Promise((resolve,reject)=>this.socket.write(Buffer.concat([head,body]),err=>err?reject(err):resolve()));}
 detach(){if(!this.socket)return;this.socket.off('data',this._onData);this.socket.off('error',this._onError);this.socket.off('close',this._onEnd);this.socket=null;}
 destroy(){const socket=this.socket;this.abort(Error('Connection closed'));this.detach();socket?.destroy();}
}

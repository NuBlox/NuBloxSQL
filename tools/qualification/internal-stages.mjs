import {EventEmitter} from 'node:events';
import {PacketStream} from '../../packages/driver/dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../../packages/driver/dist/vendors/mysql/adapter.js';
import {T} from '../../packages/driver/dist/vendors/mysql/protocol/primitives.js';
import {binaryValues,columnKeys,objectRow} from '../../packages/driver/dist/vendors/mysql/types.js';

class InMemoryMySqlSocket extends EventEmitter {
  destroyed=false;
  commands=0;
  write(data,callback){
    if(this.destroyed)throw Error('Write to a closed synthetic socket');
    // Validate the actual single-write framed COM_PING on the fast path.
    if(data.length!==5||data[0]!==1||data[1]!==0||
       data[2]!==0||data[3]!==0||data[4]!==0x0e)
      throw Error('Unexpected synthetic MySQL frame');
    this.commands++;
    // Asynchronous server response after the outbound callback.
    queueMicrotask(()=>{
      if(!this.destroyed)
        this.emit('data',Buffer.from([7,0,0,1,0,0,0,2,0,0,0]));
    });
    callback?.();
    return true;
  }
  destroy(){
    if(this.destroyed)return this;
    this.destroyed=true;
    this.emit('close');
    return this;
  }
}

const textColumn=(name,type,charset=45)=>({
  name,type,charset,length:64,decimals:0,unsigned:false,flags:0,
  schema:null,table:null,originalName:null,originalTable:null
});

function decoderStage(){
  const columns=[
    textColumn('id',T.LONGLONG),
    textColumn('label',T.VAR_STRING,45),
    textColumn('precise',T.NEWDECIMAL,63)
  ];
  const keys=columnKeys(columns);
  const id=Buffer.alloc(8);
  id.writeBigInt64LE(123456789n);
  const label=Buffer.from('NuBlox native');
  const decimal=Buffer.from('123.4500');
  const packet=Buffer.concat([
    Buffer.from([0,0]),id,Buffer.from([label.length]),label,
    Buffer.from([decimal.length]),decimal
  ]);
  const check=()=>{
    const record=objectRow(binaryValues(packet,columns),keys);
    if(record.id!==123456789n||record.label!=='NuBlox native'||
       record.precise!=='123.4500')
      throw Error('Synthetic MySQL row fidelity failure');
  };
  check();
  return {
    operationsPerSample:128,
    sample(){
      for(let i=0;i<128;i++)check();
    },
    close(){}
  };
}

function framedStage(){
  const socket=new InMemoryMySqlSocket();
  const stream=new PacketStream(socket);
  // One 256-byte logical packet; header sequence zero for each new exchange.
  const body=Buffer.alloc(256,0x57);
  const header=Buffer.from([0,1,0,0]);
  const wire=Buffer.concat([header,body]);
  return {
    operationsPerSample:1,
    async sample(){
      stream.reset();
      const read=stream.read();
      socket.emit('data',wire);
      const packet=await read;
      if(packet.length!==body.length||packet[0]!==0x57||
        packet[packet.length-1]!==0x57)
        throw Error('Synthetic MySQL packet fidelity failure');
    },
    close(){stream.destroy();}
  };
}

function pingStage(depth){
  const socket=new InMemoryMySqlSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:5000
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  let total=0;
  return {
    operationsPerSample:depth,
    async sample(){
      // Concurrent callers queue through the real native session scheduler.
      // Fake COM_PING replies remove database / network response costs.
      await Promise.all(Array.from({length:depth},
        ()=>session.healthCheckForPool(5000)));
      total+=depth;
      if(session.closed||socket.destroyed||socket.commands!==total)
        throw Error('Synthetic MySQL session scheduling mismatch');
    },
    close(){return session.close();}
  };
}

export function createInternalProfileStages(){
  return Object.freeze({
    asyncHarness:async()=>({
      operationsPerSample:1,
      async sample(){await Promise.resolve();},
      close(){}
    }),
    packetFraming:async()=>framedStage(),
    binaryRowDecode:async()=>decoderStage(),
    serialPing:async()=>pingStage(1),
    contendedPing:async({queueDepth})=>pingStage(queueDepth)
  });
}

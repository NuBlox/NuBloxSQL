import net from 'node:net';

/**
 * Test-only transparent loopback TCP fault proxy. No MySQL credentials, SQL,
 * application payloads, or packets are persisted. Arm only AFTER auth/prepare
 * to perturb exactly one application request, never a handshake by accident.
 */
export async function startMysqlFaultProxy(upstreamPort){
  const server=net.createServer();
  const sockets=new Set();
  let pending=null;
  let injected=0;

  const drop=(client,upstream)=>{
    // Terminate both halves; no automatic reconnect or SQL replay.
    client.destroy();
    upstream.destroy();
  };
  const forward=(destination,chunk)=>{
    if(!destination.destroyed&&chunk.length){
      if(!destination.write(chunk))return false;
    }
    return true;
  };

  server.on('connection',client=>{
    const upstream=net.createConnection({host:'127.0.0.1',port:upstreamPort});
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    let responsePrefix=Buffer.alloc(0);
    let responseMode=null;
    let uploadCut=false;

    client.on('data',chunk=>{
      if(!uploadCut&&pending==='drop-upload'){
        uploadCut=true;
        pending=null;
        injected++;
        // Forward just the first bytes of the outbound physical frame,
        // then tear down the session while the remaining command is missing.
        forward(upstream,chunk.subarray(0,Math.min(64,chunk.length)));
        drop(client,upstream);
        return;
      }
      if(!forward(upstream,chunk))client.pause();
    });
    upstream.on('drain',()=>client.resume());

    upstream.on('data',chunk=>{
      if(!responseMode&&pending&&pending!=='drop-upload'){
        responseMode=pending;
        pending=null;
        injected++;
      }
      if(!responseMode){
        if(!forward(client,chunk))upstream.pause();
        return;
      }
      responsePrefix=Buffer.concat([responsePrefix,chunk]);
      if(responseMode==='truncate-header'){
        if(responsePrefix.length<2)return;
        const partial=responsePrefix.subarray(0,2);
        responseMode=null;
        client.write(partial,()=>{client.end();upstream.destroy();});
        upstream.pause();
        return;
      }
      if(responsePrefix.length<4)return; // a TCP split can divide the header
      if(responseMode==='truncate-body'){
        // Advertise an intact physical frame, deliver only one payload byte.
        if(responsePrefix.length<5)return;
        const part=responsePrefix.subarray(0,5);
        responseMode=null;
        client.write(part,()=>{client.end();upstream.destroy();});
        upstream.pause();
        return;
      }
      if(responseMode==='wrong-sequence'){
        const changed=Buffer.from(responsePrefix);
        changed[3]=(changed[3]+1)&0xff;
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        if(!forward(client,changed))upstream.pause();
        return;
      }
      if(responseMode==='oversized-frame'){
        // Corrupt the first 24-bit length header; legitimate server data
        // follows, but downstream must never accept a misframed result.
        const changed=Buffer.from(responsePrefix);
        changed[0]=0xff;changed[1]=0xff;changed[2]=0xff;
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        if(!forward(client,changed))upstream.pause();
        // No full logical 16-MiB payload follows. Cut the stream to ensure
        // the original advertised frame cannot be completed.
        client.end();
        upstream.destroy();
        return;
      }
      throw Error('Unknown response fault');
    });
    client.on('drain',()=>upstream.resume());
    client.on('end',()=>upstream.end());
    upstream.on('end',()=>client.end());
    client.on('error',()=>upstream.destroy());
    upstream.on('error',()=>client.destroy());
    client.on('close',()=>{sockets.delete(client);upstream.destroy();});
    upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.off('error',reject);
      resolve();
    });
  });
  return {
    port:server.address().port,
    get injected(){return injected;},
    arm(mode){
      if(pending)throw Error('Only one pending fault is permitted');
      if(!['wrong-sequence','truncate-header','truncate-body','oversized-frame','drop-upload'].includes(mode))
        throw Error('Unknown fault mode');
      pending=mode;
    },
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}

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
      if(responseMode==='cursor-mid-fetch-error'){
        // Preserve one complete, sequence-correct binary row packet from a
        // live COM_STMT_FETCH. Replace the next response with a framed ERR
        // and withhold the server's remaining rows and EOF. The TCP socket
        // stays open so fail-closed behaviour is owned by the driver.
        const size=responsePrefix[0]|(responsePrefix[1]<<8)|(responsePrefix[2]<<16);
        if(responsePrefix.length<4+size)return;
        if(size<2||responsePrefix[4]!==0){
          responseMode=null;
          drop(client,upstream);
          return;
        }
        const errorBody=Buffer.concat([
          Buffer.from([0xff,0x48,0x04,0x23]),
          Buffer.from('HY000partial cursor fetch error','ascii')
        ]);
        const errorHeader=Buffer.from([
          errorBody.length&255,(errorBody.length>>8)&255,0,
          (responsePrefix[3]+1)&255
        ]);
        const changed=Buffer.concat([
          responsePrefix.subarray(0,4+size),errorHeader,errorBody
        ]);
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        upstream.pause();
        if(!forward(client,changed))upstream.pause();
        return;
      }
      if(responseMode==='execute-metadata-error'){
        // The prepared SELECT has already supplied its column-count packet.
        // Replace only the following metadata frame with a valid ERR packet
        // carrying the original sequence number, but keep TCP connected.
        // The server's remaining original metadata is intentionally not
        // forwarded: the client must fail closed rather than assume the
        // response boundary is safe for a next statement.
        const firstSize=responsePrefix[0]|(responsePrefix[1]<<8)|(responsePrefix[2]<<16);
        const nextHeader=4+firstSize;
        if(firstSize!==1||responsePrefix.length<nextHeader+4){
          if(firstSize!==1){responseMode=null;drop(client,upstream);}
          return;
        }
        const seq=responsePrefix[nextHeader+3];
        const errorBody=Buffer.concat([
          Buffer.from([0xff,0x48,0x04,0x23]),
          Buffer.from('HY000partial result metadata error','ascii')
        ]);
        const errorHeader=Buffer.from([
          errorBody.length&255,(errorBody.length>>8)&255,0,seq
        ]);
        const changed=Buffer.concat([
          responsePrefix.subarray(0,nextHeader),errorHeader,errorBody
        ]);
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        upstream.pause();
        if(!forward(client,changed))upstream.pause();
        return;
      }
      if(responseMode==='prepare-metadata-error'){
        // Forward the valid 12-byte COM_STMT_PREPARE_OK but replace its first
        // metadata frame with a sequence-correct MySQL server ERR packet.
        // Leave TCP open: the client must explicitly discard the socket when
        // metadata consumption fails, not rely on a connection-close event.
        const size=responsePrefix[0]|(responsePrefix[1]<<8)|(responsePrefix[2]<<16);
        if(size!==12){responseMode=null;drop(client,upstream);return;}
        if(responsePrefix.length<20)return; // prepare OK + next frame header
        const seq=responsePrefix[19];
        const errorBody=Buffer.concat([
          Buffer.from([0xff,0x48,0x04,0x23]),
          Buffer.from('HY000metadata unavailable','ascii')
        ]);
        const errorHeader=Buffer.from([
          errorBody.length&255,(errorBody.length>>8)&255,0,seq
        ]);
        const changed=Buffer.concat([
          responsePrefix.subarray(0,16),errorHeader,errorBody
        ]);
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        upstream.pause(); // never forward the remaining original metadata
        if(!forward(client,changed))upstream.pause();
        return;
      }
      if(responseMode==='prepare-trailing-byte'||responseMode==='prepare-invalid-reserved'){
        // Only the first COM_STMT_PREPARE_OK frame is modified. Preserve
        // the physical sequence number and any coalesced metadata frames.
        const size=responsePrefix[0]|(responsePrefix[1]<<8)|(responsePrefix[2]<<16);
        if(size!==12){responseMode=null;drop(client,upstream);return;}
        if(responsePrefix.length<4+size)return;
        const first=Buffer.from(responsePrefix.subarray(0,16));
        if(responseMode==='prepare-trailing-byte'){
          first[0]=13; // valid frame with one unexpected byte in payload
        }else{
          first[13]=1; // reserved byte at packet payload offset 9
        }
        const changed=responseMode==='prepare-trailing-byte'
          ?Buffer.concat([first,Buffer.from([0xff]),responsePrefix.subarray(16)])
          :Buffer.concat([first,responsePrefix.subarray(16)]);
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        if(!forward(client,changed))upstream.pause();
        return;
      }
      if(responseMode==='short-ok'){
        // Keep a syntactically valid physical frame and sequence, but send
        // only the OK marker and its two length-encoded counts. A Protocol
        // 4.1 acknowledgement MUST also contain status and warning fields.
        // The connection stays open so EOF cannot hide a lax parser.
        const replacement=Buffer.from([3,0,0,responsePrefix[3],0,0,0]);
        responsePrefix=Buffer.alloc(0);
        responseMode=null;
        if(!forward(client,replacement))upstream.pause();
        return;
      }
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
      if(!['wrong-sequence','truncate-header','truncate-body','oversized-frame','drop-upload','short-ok','prepare-trailing-byte','prepare-invalid-reserved','prepare-metadata-error','execute-metadata-error','cursor-mid-fetch-error'].includes(mode))
        throw Error('Unknown fault mode');
      pending=mode;
    },
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}

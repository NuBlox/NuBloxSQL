'use strict';

var Duplex = require('stream').Duplex;
var TdsPacket = require('./TdsPacket');

function writeBuffer(stream, buffer, callback) {
  var settled=false;
  function cleanup(){stream.removeListener('error',fail);stream.removeListener('drain',done);}
  function fail(error){if(settled)return;settled=true;cleanup();callback(error);}
  function done(){if(settled)return;settled=true;cleanup();callback();}
  stream.once('error',fail);
  var writable;
  try{writable=stream.write(buffer);}catch(error){fail(error);return;}
  if(writable!==false)done();else stream.once('drain',done);
}

function writeSeries(stream, buffers, callback) {
  var index=0;
  function next(error){if(error)return callback(error);if(index>=buffers.length)return callback();writeBuffer(stream,buffers[index++],next);}
  next();
}

function LegacyTlsBridge(socket, options) {
  Duplex.call(this);
  options=options||{};
  if(!socket||typeof socket.write!=='function'||typeof socket.on!=='function')throw new TypeError('SQL Server legacy TLS bridge requires a duplex socket');
  this.socket=socket;
  this.packetSize=options.packetSize||TdsPacket.DEFAULT_PACKET_SIZE;
  this.handshakeMode=true;
  this.parser=new TdsPacket.PacketParser();
  this._closed=false;
  var self=this;
  this._onData=function(chunk){self._accept(chunk);};
  this._onError=function(error){self.destroy(error);};
  this._onEnd=function(){if(!self.destroyed)self.push(null);};
  this._onClose=function(){self._closed=true;if(!self.destroyed)self.push(null);};
  socket.on('data',this._onData);
  socket.on('error',this._onError);
  socket.on('end',this._onEnd);
  socket.on('close',this._onClose);
}
LegacyTlsBridge.prototype=Object.create(Duplex.prototype);
LegacyTlsBridge.prototype.constructor=LegacyTlsBridge;
LegacyTlsBridge.prototype._read=function _read(){};
LegacyTlsBridge.prototype._accept=function _accept(chunk){
  if(!this.handshakeMode){this.push(chunk);return;}
  var packets;
  try{packets=this.parser.push(chunk);}catch(error){this.destroy(error);return;}
  for(var i=0;i<packets.length;i++){
    if(packets[i].type!==TdsPacket.PACKET_TYPES.PRELOGIN){this.destroy(new Error('SQL Server legacy TLS handshake received non-PRELOGIN TDS packet'));return;}
    if(packets[i].payload.length)this.push(packets[i].payload);
  }
};
LegacyTlsBridge.prototype._write=function _write(chunk,encoding,callback){
  if(this._closed)return callback(new Error('SQL Server legacy TLS transport is closed'));
  var bytes=Buffer.from(chunk);
  if(!this.handshakeMode)return writeBuffer(this.socket,bytes,callback);
  var packets;
  try{packets=TdsPacket.packetize(TdsPacket.PACKET_TYPES.PRELOGIN,bytes,{packetSize:this.packetSize});}
  catch(error){callback(error);return;}
  writeSeries(this.socket,packets,callback);
};
LegacyTlsBridge.prototype.activateRaw=function activateRaw(){
  if(!this.handshakeMode)return;
  if(this.parser.bufferedBytes()!==0)throw new Error('SQL Server legacy TLS handshake ended with a partial TDS packet');
  this.handshakeMode=false;
};
LegacyTlsBridge.prototype._final=function _final(callback){if(!this.socket||this.socket.destroyed)return callback();this.socket.end(callback);};
LegacyTlsBridge.prototype._destroy=function _destroy(error,callback){
  if(this.socket){this.socket.removeListener('data',this._onData);this.socket.removeListener('error',this._onError);this.socket.removeListener('end',this._onEnd);this.socket.removeListener('close',this._onClose);if(!this.socket.destroyed)this.socket.destroy();}
  callback(error);
};

exports.LegacyTlsBridge=LegacyTlsBridge;

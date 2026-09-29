'use strict';

var net=require('net');
var tls=require('tls');
var TdsPacket=require('./TdsPacket');
var Prelogin=require('./Prelogin');
var Login7=require('./Login7');
var TokenStream=require('./TokenStream');
var MessageIO=require('./MessageIO').MessageIO;
var LegacyTlsBridge=require('./LegacyTlsBridge').LegacyTlsBridge;

function timeoutError(SqlServerError,message){return new SqlServerError(message,{code:'NUBLOX_SQLSERVER_CONNECT_TIMEOUT',category:'timeout',retryable:true});}
function connectRaw(config,SqlServerError){
  var timeout=config.connectTimeout===undefined?15000:config.connectTimeout;
  if(!Number.isFinite(timeout)||timeout<=0)return Promise.reject(new RangeError('SQL Server connectTimeout must be a positive number'));
  return new Promise(function(resolve,reject){
    var socket=net.connect({host:config.host||'127.0.0.1',port:config.port===undefined?1433:config.port});
    var timer=setTimeout(function(){cleanup();socket.destroy();reject(timeoutError(SqlServerError,'SQL Server TCP connection timed out'));},timeout);
    function cleanup(){clearTimeout(timer);socket.removeListener('connect',ready);socket.removeListener('error',fail);}
    function ready(){cleanup();resolve(socket);}
    function fail(error){cleanup();socket.destroy();reject(error);}
    socket.once('connect',ready);socket.once('error',fail);
  });
}
function onceSecure(socket,timeout,SqlServerError){
  return new Promise(function(resolve,reject){
    var timer=setTimeout(function(){cleanup();reject(timeoutError(SqlServerError,'SQL Server TLS handshake timed out'));},timeout);
    function cleanup(){clearTimeout(timer);socket.removeListener('secureConnect',ready);socket.removeListener('error',fail);socket.removeListener('close',closed);}
    function ready(){cleanup();resolve();}
    function fail(error){cleanup();reject(error);}
    function closed(){cleanup();reject(new SqlServerError('SQL Server transport closed during TLS handshake'));}
    socket.once('secureConnect',ready);socket.once('error',fail);socket.once('close',closed);
  });
}
function tlsOptions(config,bridge){
  var options={socket:bridge,minVersion:config.minTlsVersion||'TLSv1.2',rejectUnauthorized:config.rejectUnauthorized!==false};
  var host=config.host||'127.0.0.1';
  var serverName=config.serverName||config.hostnameInCertificate;
  if(!serverName&&!net.isIP(host))serverName=host;
  if(serverName)options.servername=serverName;
  ['ca','cert','key','pfx','passphrase','ciphers','maxVersion'].forEach(function(name){if(config[name]!==undefined)options[name]=config[name];});
  return options;
}
function preloginPayload(config){return Prelogin.encode({version:config.clientVersion||{major:1,minor:0,build:0,subbuild:0},encryption:Prelogin.ENCRYPTION.REQUIRED,instance:config.instance||'',threadId:config.clientPid===undefined?process.pid:config.clientPid,mars:config.mars===true});}
function loginPayload(connection){var config=connection.config;return Login7.encode({tdsVersion:Login7.TDS_74,packetSize:connection.packetSize,clientProgramVersion:config.clientProgramVersion,clientPid:config.clientPid,hostName:config.hostName||'',user:config.user||'',password:config.password||'',appName:config.appName||'NuBloxSQL',serverName:config.serverName||config.host||'',database:config.database||'',language:config.language||'',clientId:config.clientId,readOnlyIntent:config.readOnlyIntent===true});}
function applyLogin(connection,response,io,SqlServerError){
  connection.loginResponse=response;
  if(!response.success){var nativeError=response.errors[0]||null;throw new SqlServerError(nativeError?nativeError.message:'SQL Server login failed',{code:nativeError?nativeError.number:null,severity:nativeError?nativeError.severity:null,state:nativeError?nativeError.state:null,native:nativeError});}
  for(var i=0;i<response.tokens.length;i++){var token=response.tokens[i];if(token.type==='envchange'&&token.changeType===4){var negotiated=Number(token.newValue);if(Number.isInteger(negotiated)&&negotiated>=512&&negotiated<=TdsPacket.MAX_PACKET_LENGTH){connection.packetSize=negotiated;io.setPacketSize(negotiated);}}}
}
async function connectTds74(connection,SqlServerError){
  var config=connection.config;
  var timeout=config.connectTimeout===undefined?15000:config.connectTimeout;
  var raw=await connectRaw(config,SqlServerError);
  connection.socket=raw;
  var plainIO=new MessageIO(raw,{packetSize:connection.packetSize});
  try{
    await plainIO.writeMessage(TdsPacket.PACKET_TYPES.PRELOGIN,preloginPayload(config));
    var preloginMessage=await plainIO.readMessage(timeout);
    if(preloginMessage.type!==TdsPacket.PACKET_TYPES.RESPONSE)throw new SqlServerError('SQL Server returned unexpected PRELOGIN response packet type',{packetType:preloginMessage.type});
    connection.serverPrelogin=Prelogin.decode(preloginMessage.payload);
    if(connection.serverPrelogin.encryption===Prelogin.ENCRYPTION.NOT_SUPPORTED)throw new SqlServerError('SQL Server does not support the encrypted TDS 7.4 transport requested by NuBloxSQL',{code:'NUBLOX_SQLSERVER_ENCRYPTION_UNAVAILABLE'});
  }finally{plainIO.detach();}

  var bridge=new LegacyTlsBridge(raw,{packetSize:connection.packetSize});
  var secure=tls.connect(tlsOptions(config,bridge));
  connection.socket=secure;
  await onceSecure(secure,timeout,SqlServerError);
  bridge.activateRaw();

  var io=new MessageIO(secure,{packetSize:connection.packetSize});
  connection.io=io;
  await io.writeMessage(TdsPacket.PACKET_TYPES.LOGIN7,loginPayload(connection));
  var loginMessage=await io.readMessage(timeout);
  if(loginMessage.type!==TdsPacket.PACKET_TYPES.RESPONSE)throw new SqlServerError('SQL Server returned unexpected LOGIN7 response packet type',{packetType:loginMessage.type});
  applyLogin(connection,TokenStream.parseLoginResponse(loginMessage.payload),io,SqlServerError);
  connection.transportVersion='7.4';
}
function install(Connection,SqlServerError){
  if(Connection.prototype._nubloxLegacyTransportInstalled)return;
  var strictConnect=Connection.prototype.connect;
  Connection.prototype.connect=function connect(){
    var requested=this.config&&this.config.tdsVersion;
    if(requested===undefined||requested===null||requested==='8.0'||requested==='8')return strictConnect.call(this);
    if(requested!=='7.4'&&requested!=='7_4')return Promise.reject(new RangeError('SQL Server tdsVersion must be 8.0 or 7.4'));
    if(this.connected)return Promise.resolve(this);
    if(this.ended)return Promise.reject(new SqlServerError('SQL Server connection is closed'));
    if(this._connectPromise)return this._connectPromise;
    var self=this;
    this._connectPromise=connectTds74(this,SqlServerError).then(function(){self.connected=true;return self;}).catch(function(error){self._destroy();throw error;}).finally(function(){self._connectPromise=null;});
    return this._connectPromise;
  };
  Object.defineProperty(Connection.prototype,'_nubloxLegacyTransportInstalled',{value:true});
}

exports.install=install;
exports.connectTds74=connectTds74;
exports.tlsOptions=tlsOptions;

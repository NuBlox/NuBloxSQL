'use strict';

var output=require('./Output');
var commands=require('./CommandRouter');

function Shell(options){
  options=options||{};
  if(!options.sqlApi)throw new TypeError('NuBlox Shell requires the public nubloxsql API');
  this.sqlApi=options.sqlApi;
  this.client=options.client||null;
  // Credentials exist only inside the live Shell process, never on disk.
  this._connection=null;
  this.historyEnabled=false;
  this.history=[];
  this.format=options.format||'table';
  if(output.FORMATS.indexOf(this.format)===-1)throw new RangeError('Unsupported NuBlox Shell output format "'+this.format+'"');
}
Shell.prototype.connect=function connect(connection){
  if(this.client)throw new Error('NuBlox Shell already has a client; close it before reconnecting');
  var client=this.sqlApi.createClient(connection);
  this.client=client;
  this._connection=connection;
  return client;
};
Shell.prototype.close=async function close(){
  if(!this.client)return;
  var current=this.client;
  this.client=null;
  if(typeof current.close==='function')await current.close();
};
Shell.prototype.reconnect=async function reconnect(){
  if(!this._connection)throw new Error('NuBlox Shell has no previous connection to reconnect');
  await this.close();
  return this.connect(this._connection);
};
Shell.prototype.status=function status(){
  if(!this.client)return {connected:false,historyEnabled:this.historyEnabled};
  return {connected:true,dialect:this.client.dialect,historyEnabled:this.historyEnabled};
};
Shell.prototype.setHistory=function setHistory(enabled){
  this.historyEnabled=enabled===true;
  if(!enabled)this.history.length=0;
};
Shell.prototype.recordSql=function recordSql(statement,outcome){
  if(!this.historyEnabled)return;
  this.history.push(Object.freeze({
    sequence:this.history.length?this.history[this.history.length-1].sequence+1:1,
    outcome:outcome,
    sql:String(statement).slice(0,512)
  }));
  if(this.history.length>50)this.history.shift();
};
Shell.prototype.prompt=function prompt(){
  if(!this.client)return 'nublox> ';
  var config=this.client.config||{};
  var target=config.database||config.filename||config.host||'connected';
  return this.client.dialect+'/'+target+'> ';
};
Shell.prototype.executeSql=async function executeSql(statement){
  if(!this.client)throw new Error('NuBlox Shell is not connected');
  try{
    var result=await this.client.query(statement);
    this.recordSql(statement,'success');
    if(result.rows&&result.rows.length)return {kind:'data',value:result.rows,sqlResult:result};
    return {kind:'text',value:[
      result.command||'OK',
      'rowCount='+String(result.rowCount===undefined?0:result.rowCount),
      'affectedRows='+String(result.affectedRows===null||result.affectedRows===undefined?0:result.affectedRows)
    ].join(' ')};
  }catch(error){
    this.recordSql(statement,'failed');
    throw error;
  }
};
Shell.prototype.executeLine=async function executeLine(line){
  line=String(line||'').trim();
  if(!line)return {kind:'empty'};
  if(line.charAt(0)==='\\')return commands.execute(this,line);
  return this.executeSql(line);
};
Shell.prototype.render=function render(result){
  if(!result||result.kind==='empty'||result.kind==='quit')return '';
  if(result.kind==='text')return String(result.value);
  if(result.kind==='describe'&&this.format==='table'){
    return [
      'TABLE',output.render(result.value.table||[],this.format),
      '', 'COLUMNS',output.render(result.value.columns||[],this.format),
      '', 'INDEXES',output.render(result.value.indexes||[],this.format),
      '', 'FOREIGN KEYS',output.render(result.value.foreignKeys||[],this.format),
      '', 'CONSTRAINTS',output.render(result.value.constraints||[],this.format)
    ].join('\n');
  }
  if(result.kind==='data'||result.kind==='describe')return output.render(result.value,this.format);
  return output.render(result,this.format);
};

exports.Shell=Shell;

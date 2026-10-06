'use strict';

var output=require('./Output');
var commands=require('./CommandRouter');

function Shell(options){
  options=options||{};
  if(!options.sqlApi)throw new TypeError('NuBlox Shell requires the public nubloxsql API');
  this.sqlApi=options.sqlApi;
  this.client=options.client||null;
  this.format=options.format||'table';
  if(output.FORMATS.indexOf(this.format)===-1)throw new RangeError('Unsupported NuBlox Shell output format "'+this.format+'"');
}
Shell.prototype.connect=function connect(connection){
  if(this.client)throw new Error('NuBlox Shell already has a client; close it before reconnecting');
  this.client=this.sqlApi.createClient(connection);
  return this.client;
};
Shell.prototype.close=async function close(){
  if(!this.client)return;
  var current=this.client;
  this.client=null;
  if(typeof current.close==='function')await current.close();
};
Shell.prototype.prompt=function prompt(){
  if(!this.client)return 'nublox> ';
  var config=this.client.config||{};
  var target=config.database||config.filename||config.host||'connected';
  return this.client.dialect+'/'+target+'> ';
};
Shell.prototype.executeSql=async function executeSql(statement){
  if(!this.client)throw new Error('NuBlox Shell is not connected');
  var result=await this.client.query(statement);
  if(result.rows&&result.rows.length)return {kind:'data',value:result.rows,sqlResult:result};
  return {kind:'text',value:[
    result.command||'OK',
    'rowCount='+String(result.rowCount===undefined?0:result.rowCount),
    'affectedRows='+String(result.affectedRows===null||result.affectedRows===undefined?0:result.affectedRows)
  ].join(' ')};
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
  if(result.kind==='data')return output.render(result.value,this.format);
  return output.render(result,this.format);
};

exports.Shell=Shell;

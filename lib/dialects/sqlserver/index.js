'use strict';

var tds=require('./lib/TdsPacket');
var prelogin=require('./lib/Prelogin');
var login7=require('./lib/Login7');
var tokenStream=require('./lib/TokenStream');
var resultStream=require('./lib/ResultStream');
var allHeaders=require('./lib/AllHeaders');
var connectionApi=require('./lib/Connection');
var capabilities=Object.freeze({rawQuery:true,preparedStatements:false,serverSideCursors:false,savepoints:false,catalogs:false,schemas:false,transactionalDdl:false,queryCancellation:false,changeDataCapture:false,nativeJson:false,multipleActiveResults:false});
var plannedCapabilities=Object.freeze({preparedStatements:true,serverSideCursors:true,savepoints:true,catalogs:true,schemas:true,transactionalDdl:true,queryCancellation:true,changeDataCapture:true,nativeJson:true,multipleActiveResults:true});
function quoteIdentifier(identifier){if(typeof identifier!=='string'||identifier.length===0)throw new TypeError('SQL Server identifier must be a non-empty string');if(identifier.indexOf('\0')!==-1)throw new TypeError('SQL Server identifier cannot contain NUL bytes');return '['+identifier.replace(/\]/g,']]')+']';}
function placeholder(index){if(!Number.isInteger(index)||index<1)throw new RangeError('SQL Server placeholder index must be a positive integer');return '@p'+index;}
var services=Object.freeze({quoteIdentifier:quoteIdentifier,placeholder:placeholder});
var descriptor=Object.freeze({identity:Object.freeze({family:'sqlserver',name:'Microsoft SQL Server',status:'development'}),capabilities:capabilities,plannedCapabilities:plannedCapabilities,services:services,supports:function(capability){return capabilities[capability]===true;}});
function createConnection(config){return new connectionApi.Connection(config);}
exports.descriptor=descriptor;
exports.capabilities=capabilities;
exports.plannedCapabilities=plannedCapabilities;
exports.services=services;
exports.Connection=connectionApi.Connection;
exports.SqlServerError=connectionApi.SqlServerError;
exports.createConnection=createConnection;
exports.TdsPacket=tds;
exports.Prelogin=prelogin;
exports.Login7=login7;
exports.TokenStream=tokenStream;
exports.ResultStream=resultStream;
exports.AllHeaders=allHeaders;

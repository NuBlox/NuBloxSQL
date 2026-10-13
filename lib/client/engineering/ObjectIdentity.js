'use strict';

var SCHEMA_VERSION=1;

function text(value,fallback){
  if(value===undefined||value===null||value==='')return fallback||'~';
  return String(value);
}
function encRequired(value){return encodeURIComponent(String(value));}
function encValue(value){
  if(value===undefined||value===null||value==='')return '~';
  return encodeURIComponent('v:'+String(value));
}
function decValue(value){
  var decoded=decodeURIComponent(value);
  if(decoded==='~')return null;
  if(decoded.indexOf('v:')!==0)throw new TypeError('Invalid NuBloxSQL object identity segment');
  return decoded.slice(2);
}
function list(value){return Array.isArray(value)?value.map(String):[];}

function inferName(kind,metadata){
  metadata=metadata||{};
  if(metadata.name!==undefined&&metadata.name!==null&&metadata.name!=='')return String(metadata.name);
  if(kind==='foreign-key'){
    return 'fk['+list(metadata.columns).join(',')+']->'+text(metadata.referencedTable,'?')+'['+list(metadata.referencedColumns).join(',')+']';
  }
  if(kind==='constraint'){
    return 'constraint['+text(metadata.type,'unknown')+']['+list(metadata.columns).join(',')+']['+text(metadata.definition,'')+']';
  }
  return '~';
}

function objectId(kind,metadata,context){
  if(typeof kind!=='string'||!kind.trim())throw new TypeError('NuBloxSQL object identity requires a kind');
  metadata=metadata||{};
  context=context||{};
  var dialect=text(context.dialect||metadata.dialect,'unknown');
  var database=metadata.database!==undefined?metadata.database:context.database;
  var schema=metadata.schema!==undefined?metadata.schema:context.schema;
  var table=metadata.table!==undefined?metadata.table:context.table;
  var name=inferName(kind,metadata);
  if(kind==='database'){database=name;schema=null;table=null;}
  else if(kind==='schema'){schema=name;table=null;}
  else if(kind==='table'||kind==='view'||kind==='foreign-table'){table=name;}
  return 'nubloxsql://'+encRequired(dialect)+'/'+encRequired(kind)+'/'+encValue(database)+'/'+encValue(schema)+'/'+encValue(table)+'/'+encValue(name);
}

function parse(id){
  if(typeof id!=='string'||id.indexOf('nubloxsql://')!==0)throw new TypeError('Invalid NuBloxSQL object identity');
  var parts=id.slice('nubloxsql://'.length).split('/');
  if(parts.length!==6)throw new TypeError('Invalid NuBloxSQL object identity');
  return Object.freeze({dialect:decodeURIComponent(parts[0]),kind:decodeURIComponent(parts[1]),database:decValue(parts[2]),schema:decValue(parts[3]),table:decValue(parts[4]),name:decValue(parts[5])});
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.objectId=objectId;
exports.parse=parse;

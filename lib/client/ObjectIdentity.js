'use strict';

var SCHEMA_VERSION=1;

function text(value,fallback){
  if(value===undefined||value===null||value==='')return fallback||'~';
  return String(value);
}
function enc(value){return encodeURIComponent(text(value,'~'));}
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
  var database=text(metadata.database!==undefined?metadata.database:context.database,'~');
  var schema=text(metadata.schema!==undefined?metadata.schema:context.schema,'~');
  var table=text(metadata.table!==undefined?metadata.table:context.table,'~');
  var name=inferName(kind,metadata);
  if(kind==='database'){database=name;schema='~';table='~';}
  else if(kind==='schema'){schema=name;table='~';}
  else if(kind==='table'||kind==='view'||kind==='foreign-table'){table=name;}
  return 'nubloxsql://'+enc(dialect)+'/'+enc(kind)+'/'+enc(database)+'/'+enc(schema)+'/'+enc(table)+'/'+enc(name);
}

function parse(id){
  if(typeof id!=='string'||id.indexOf('nubloxsql://')!==0)throw new TypeError('Invalid NuBloxSQL object identity');
  var parts=id.slice('nubloxsql://'.length).split('/').map(decodeURIComponent);
  if(parts.length!==6)throw new TypeError('Invalid NuBloxSQL object identity');
  return Object.freeze({dialect:parts[0],kind:parts[1],database:parts[2],schema:parts[3],table:parts[4],name:parts[5]});
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.objectId=objectId;
exports.parse=parse;

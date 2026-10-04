'use strict';

var SCHEMA_VERSION=1;

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){freeze(value[key]);});
  return Object.freeze(value);
}

function nameOf(value,fallback){
  return value===null||value===undefined||value===''?(fallback||null):String(value);
}

function sortByName(values){
  return values.slice().sort(function(a,b){
    return String(a.name||'').localeCompare(String(b.name||''));
  });
}

function node(kind,name,path,metadata,children){
  return freeze({
    kind:kind,
    name:name,
    path:freeze(path.slice()),
    metadata:metadata||null,
    children:freeze((children||[]).slice())
  });
}

function tableChildren(table,options){
  var children=[];
  if(options.columns!==false){
    sortByName(table.columns||[]).sort(function(a,b){
      var ao=a.ordinal===null||a.ordinal===undefined?Number.MAX_SAFE_INTEGER:Number(a.ordinal);
      var bo=b.ordinal===null||b.ordinal===undefined?Number.MAX_SAFE_INTEGER:Number(b.ordinal);
      return ao-bo||String(a.name).localeCompare(String(b.name));
    }).forEach(function(column){
      children.push(node('column',column.name,[table.database,table.schema,table.name,column.name],column,[]));
    });
  }
  if(options.indexes!==false){
    sortByName(table.indexes||[]).forEach(function(index){
      children.push(node('index',index.name,[table.database,table.schema,table.name,index.name],index,[]));
    });
  }
  if(options.foreignKeys!==false){
    sortByName(table.foreignKeys||[]).forEach(function(fk){
      children.push(node('foreign-key',nameOf(fk.name,'(unnamed foreign key)'),[table.database,table.schema,table.name,fk.name||'(unnamed foreign key)'],fk,[]));
    });
  }
  if(options.constraints!==false){
    sortByName(table.constraints||[]).forEach(function(constraint){
      children.push(node('constraint',nameOf(constraint.name,'(unnamed constraint)'),[table.database,table.schema,table.name,constraint.name||'(unnamed constraint)'],constraint,[]));
    });
  }
  return children;
}

function build(snapshot,options){
  if(!snapshot||typeof snapshot!=='object')throw new TypeError('NuBloxSQL structure tree requires a metadata snapshot');
  var portable=snapshot.portable||snapshot;
  if(!portable||!Array.isArray(portable.tables))throw new TypeError('NuBloxSQL structure tree requires portable metadata with tables');
  options=options||{};
  var dialect=portable.dialect||snapshot.dialect||null;
  var databaseMap=Object.create(null);
  var databaseOrder=[];

  function databaseKey(name){return nameOf(name,'(default database)');}
  function schemaKey(name){return nameOf(name,'(default schema)');}

  (portable.databases||[]).forEach(function(database){
    var key=databaseKey(database.name);
    if(!databaseMap[key]){
      databaseMap[key]={metadata:database,schemas:Object.create(null),schemaOrder:[]};
      databaseOrder.push(key);
    }
  });

  (portable.schemas||[]).forEach(function(schema){
    var dbKey=databaseKey(schema.database);
    if(!databaseMap[dbKey]){
      databaseMap[dbKey]={metadata:null,schemas:Object.create(null),schemaOrder:[]};
      databaseOrder.push(dbKey);
    }
    var sKey=schemaKey(schema.name);
    if(!databaseMap[dbKey].schemas[sKey]){
      databaseMap[dbKey].schemas[sKey]={metadata:schema,tables:[]};
      databaseMap[dbKey].schemaOrder.push(sKey);
    }
  });

  portable.tables.forEach(function(table){
    var dbKey=databaseKey(table.database);
    if(!databaseMap[dbKey]){
      databaseMap[dbKey]={metadata:null,schemas:Object.create(null),schemaOrder:[]};
      databaseOrder.push(dbKey);
    }
    var sKey=schemaKey(table.schema);
    if(!databaseMap[dbKey].schemas[sKey]){
      databaseMap[dbKey].schemas[sKey]={metadata:null,tables:[]};
      databaseMap[dbKey].schemaOrder.push(sKey);
    }
    databaseMap[dbKey].schemas[sKey].tables.push(table);
  });

  var databaseNodes=databaseOrder.sort().map(function(dbKey){
    var database=databaseMap[dbKey];
    var schemaNodes=database.schemaOrder.sort().map(function(sKey){
      var schema=database.schemas[sKey];
      var tables=sortByName(schema.tables).map(function(table){
        return node(table.kind||'table',table.name,[dbKey,sKey,table.name],table,tableChildren(table,options));
      });
      return node('schema',sKey,[dbKey,sKey],schema.metadata,tables);
    });
    return node('database',dbKey,[dbKey],database.metadata,schemaNodes);
  });

  var summary={databases:databaseNodes.length,schemas:0,tables:0,views:0,foreignTables:0,columns:0,indexes:0,foreignKeys:0,constraints:0};
  databaseNodes.forEach(function(database){
    summary.schemas+=database.children.length;
    database.children.forEach(function(schema){
      schema.children.forEach(function(table){
        if(table.kind==='view')summary.views+=1;
        else if(table.kind==='foreign-table')summary.foreignTables+=1;
        else summary.tables+=1;
        table.children.forEach(function(child){
          if(child.kind==='column')summary.columns+=1;
          else if(child.kind==='index')summary.indexes+=1;
          else if(child.kind==='foreign-key')summary.foreignKeys+=1;
          else if(child.kind==='constraint')summary.constraints+=1;
        });
      });
    });
  });

  return freeze({
    schemaVersion:SCHEMA_VERSION,
    dialect:dialect,
    scope:portable.scope||snapshot.scope||freeze({}),
    summary:freeze(summary),
    databases:freeze(databaseNodes)
  });
}

exports.SCHEMA_VERSION=SCHEMA_VERSION;
exports.build=build;

'use strict';

// Present only bounded, portable, display-safe metadata from the public API.
// Native catalogue records and DDL texts never enter the browser by accident.
const LIMIT=100;
const COLUMN_LIMIT=32;
const TEXT_LIMIT=320;
function field(value){
  if(value===undefined||value===null)return null;
  return String(value).slice(0,TEXT_LIMIT);
}
function names(values){
  return Array.isArray(values)?values.slice(0,COLUMN_LIMIT).map(field):[];
}
function list(table,key,project){
  const records=Array.isArray(table[key])?table[key]:[];
  return {
    entries:records.slice(0,LIMIT).map(project),
    truncated:records.length>LIMIT
  };
}
function normalizeSchemaDetail(table){
  if(!table||typeof table!=='object'||!table.name)throw new TypeError('Schema inspection requires a metadata table');
  const columns=list(table,'columns',col=>({
    name:field(col.name),dataType:field(col.dataType||col.nativeType),
    nullable:col.nullable===null||col.nullable===undefined?null:col.nullable===true,
    primaryKey:col.primaryKey===true,
    generated:col.generated===true,
    identity:col.identity===true,
    default:field(col.default)
  }));
  const indexes=list(table,'indexes',index=>({
    name:field(index.name),
    unique:index.unique===true,
    primary:index.primary===true,
    method:field(index.method),
    columns:names(index.columns),
    partial:index.partial===true
  }));
  const foreignKeys=list(table,'foreignKeys',fk=>({
    name:field(fk.name),
    columns:names(fk.columns),
    referencedSchema:field(fk.referencedSchema),
    referencedTable:field(fk.referencedTable),
    referencedColumns:names(fk.referencedColumns),
    onUpdate:field(fk.onUpdate),
    onDelete:field(fk.onDelete)
  }));
  const constraints=list(table,'constraints',constraint=>({
    name:field(constraint.name),
    type:field(constraint.type),
    columns:names(constraint.columns)
  }));
  return {
    table:{
      name:field(table.name),schema:field(table.schema),
      type:field(table.type||'table')
    },
    columns:columns.entries,indexes:indexes.entries,
    foreignKeys:foreignKeys.entries,constraints:constraints.entries,
    truncated:{
      columns:columns.truncated,indexes:indexes.truncated,
      foreignKeys:foreignKeys.truncated,constraints:constraints.truncated
    }
  };
}
module.exports=Object.freeze({normalizeSchemaDetail});

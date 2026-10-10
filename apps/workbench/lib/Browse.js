'use strict';

// Bounded metadata-validated browsing: quoted identifiers + parameterized
// values using the public NuBloxSQL SQL tagged-template contract.
function bad(message){const error=new Error(message);error.status=400;return error;}
function numeric(value,name,defaultValue,max){
  if(value===undefined)return defaultValue;
  if(!Number.isSafeInteger(value)||value<0||value>max)throw bad(name+' must be an integer from 0 to '+max);
  return value;
}
function buildBrowsePlan(input){
  if(!input||typeof input!=='object'||!input.sqlApi||typeof input.sqlApi.sql!=='function'||
     !input.table||!Array.isArray(input.columns)){
    throw new TypeError('Browse plan requires public SQL API, validated table and metadata columns');
  }
  const sql=input.sqlApi.sql;
  const dialect=input.dialect;
  if(!['sqlite','postgresql','mysql','sqlserver'].includes(dialect))throw bad('Unsupported browse dialect');
  const options=input.options||{};
  const size=numeric(options.pageSize,'pageSize',Math.min(50,input.maxRows),input.maxRows);
  if(size===0)throw bad('pageSize must be at least 1');
  const offset=numeric(options.offset,'offset',0,10000000);
  const names=input.columns.map(function(col){return col.name;}).filter(function(name){
    return typeof name==='string'&&name.length>0;
  });
  if(!names.length)throw bad('Table has no browsable columns');
  const primary=input.columns.find(function(col){return col.primaryKey===true;});
  const sort=options.sort===undefined?(primary?primary.name:names[0]):options.sort;
  if(typeof sort!=='string'||!names.includes(sort))throw bad('Sort column must exist in the table');
  const direction=options.direction===undefined?'asc':options.direction;
  if(direction!=='asc'&&direction!=='desc')throw bad('Sort direction must be asc or desc');
  const filter=options.filter;
  let predicate=sql``;
  if(filter!==undefined&&filter!==null){
    if(!filter||typeof filter!=='object'||Array.isArray(filter)||
       typeof filter.column!=='string'||!names.includes(filter.column)||
       typeof filter.value!=='string'||filter.value.length>256){
      throw bad('Filter requires a valid table column and text value (maximum 256 characters)');
    }
    predicate=sql` WHERE ${sql.identifier(filter.column)} = ${filter.value}`;
  }
  const from=sql.identifier(...(input.table.schema?
    [input.table.schema,input.table.name]:[input.table.name]));
  const order=sql.identifier(sort);
  const dir=direction==='desc'?sql` DESC`:sql` ASC`;
  const fetchSize=size+1;
  const statement=dialect==='sqlserver'?
    sql`SELECT * FROM ${from}${predicate} ORDER BY ${order}${dir} OFFSET ${offset} ROWS FETCH NEXT ${fetchSize} ROWS ONLY`:
    sql`SELECT * FROM ${from}${predicate} ORDER BY ${order}${dir} LIMIT ${fetchSize} OFFSET ${offset}`;
  return Object.freeze({statement,offset,pageSize:size,sort,direction,filtered:!!filter});
}
module.exports=Object.freeze({buildBrowsePlan});

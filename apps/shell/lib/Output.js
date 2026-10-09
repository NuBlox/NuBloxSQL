'use strict';

var FORMATS=Object.freeze(['table','json','jsonl','csv']);

function scalar(value){
  if(value===null)return '';
  if(value===undefined)return '';
  if(typeof value==='bigint')return String(value);
  if(value instanceof Date)return value.toISOString();
  if(typeof value==='object'){
    try{return JSON.stringify(value,function(key,item){return typeof item==='bigint'?String(item):item;});}
    catch(ignore){return String(value);}
  }
  return String(value);
}
function jsonValue(value){
  return JSON.stringify(value,function(key,item){return typeof item==='bigint'?String(item):item;},2);
}
function rowsOf(value){
  if(Array.isArray(value))return value;
  if(value&&typeof value==='object')return [value];
  return [{value:value}];
}
function columnsOf(rows){
  var seen=Object.create(null), columns=[];
  rows.forEach(function(row){
    if(!row||typeof row!=='object'||Array.isArray(row))return;
    Object.keys(row).forEach(function(key){
      if(!seen[key]){seen[key]=true;columns.push(key);}
    });
  });
  return columns.length?columns:['value'];
}
function rowObject(row,columns){
  if(row&&typeof row==='object'&&!Array.isArray(row))return row;
  var result={};
  result[columns[0]||'value']=row;
  return result;
}
function table(value){
  var rows=rowsOf(value);
  if(!rows.length)return '(0 rows)';
  var columns=columnsOf(rows);
  var widths=columns.map(function(name){return name.length;});
  rows.forEach(function(row){
    row=rowObject(row,columns);
    columns.forEach(function(name,index){widths[index]=Math.max(widths[index],scalar(row[name]).length);});
  });
  function border(){
    return '+'+widths.map(function(width){return '-'.repeat(width+2);}).join('+')+'+';
  }
  function line(row){
    row=rowObject(row,columns);
    return '|'+columns.map(function(name,index){
      var text=scalar(row[name]);
      return ' '+text+' '.repeat(widths[index]-text.length+1);
    }).join('|')+'|';
  }
  var out=[border()];
  out.push('|'+columns.map(function(name,index){return ' '+name+' '.repeat(widths[index]-name.length+1);}).join('|')+'|');
  out.push(border());
  rows.forEach(function(row){out.push(line(row));});
  out.push(border());
  out.push('('+rows.length+' row'+(rows.length===1?'':'s')+')');
  return out.join('\n');
}
function csvCell(value){
  var text=scalar(value);
  return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}
function csv(value){
  var rows=rowsOf(value);
  if(!rows.length)return '';
  var columns=columnsOf(rows);
  var lines=[columns.map(csvCell).join(',')];
  rows.forEach(function(row){
    row=rowObject(row,columns);
    lines.push(columns.map(function(name){return csvCell(row[name]);}).join(','));
  });
  return lines.join('\n');
}
function jsonl(value){
  return rowsOf(value).map(function(row){return jsonValue(row).replace(/\n\s*/g,' ');}).join('\n');
}
function render(value,format){
  format=format||'table';
  if(FORMATS.indexOf(format)===-1)throw new RangeError('NuBlox Shell output format must be one of: '+FORMATS.join(', '));
  if(format==='json')return jsonValue(value);
  if(format==='jsonl')return jsonl(value);
  if(format==='csv')return csv(value);
  return table(value);
}

exports.FORMATS=FORMATS;
exports.render=render;
exports.table=table;
exports.csv=csv;
exports.jsonl=jsonl;

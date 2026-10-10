'use strict';
// Lexical completion helper. Suggestions use real NuBloxSQL catalogue metadata.
// It does not pretend to be a full SQL language server or SQL parser.
(function(global){
  const KEYWORDS=[
    'SELECT','DISTINCT','FROM','WHERE','JOIN','INNER','LEFT','RIGHT','ON','AS',
    'GROUP BY','ORDER BY','HAVING','ASC','DESC','LIMIT','OFFSET','AND','OR','NOT',
    'IS NULL','IS NOT NULL','LIKE','IN','BETWEEN','CASE','WHEN','THEN','ELSE',
    'END','COUNT','SUM','AVG','MIN','MAX','INSERT INTO','VALUES','UPDATE','SET',
    'DELETE FROM','CREATE TABLE','WITH','UNION ALL'
  ];
  function identifier(name,dialect){
    if(dialect==='mysql')return '`'+name.replace(/`/g,'``')+'`';
    if(dialect==='sqlserver')return '['+name.replace(/]/g,']]')+']';
    return '"'+name.replace(/"/g,'""')+'"';
  }
  function insideLiteral(text,position,dialect){
    let state='code';
    for(let i=0;i<position;i++){
      const ch=text[i],next=text[i+1];
      if(state==='line'){if(ch==='\n')state='code';continue;}
      if(state==='block'){if(ch==='*'&&next==='/'){i++;state='code';}continue;}
      if(state==='single'||state==='double'||state==='backtick'){
        const mark=state==='single'?"'":state==='double'?'"':'`';
        if(ch===mark){if(next===mark){i++;}else state='code';}
        else if(ch==='\\'&&dialect==='mysql')i++;
        continue;
      }
      if(state==='bracket'){if(ch===']'){if(next===']')i++;else state='code';}continue;}
      if(ch==='-'&&next==='-'){i++;state='line';}
      else if(ch==='/'&&next==='*'){i++;state='block';}
      else if(ch==='#'&&dialect==='mysql')state='line';
      else if(ch==="'")state='single';
      else if(ch==='"')state='double';
      else if(ch==='`'&&dialect==='mysql')state='backtick';
      else if(ch==='['&&dialect==='sqlserver')state='bracket';
    }
    return state!=='code';
  }
  function suggestions(text,position,options){
    options=options||{};
    if(typeof text!=='string'||!Number.isInteger(position)||position<0||position>text.length)return [];
    if(insideLiteral(text,position,options.dialect))return [];
    const before=text.slice(0,position);
    const word=before.match(/[A-Za-z_][A-Za-z0-9_$]*$/);
    const prefix=word?word[0]:'';
    const from=position-prefix.length;
    // A suffix must not be silently overwritten.
    if(position<text.length&&/[A-Za-z0-9_$]/.test(text[position]))return [];
    if(!prefix&&!options.manual)return [];
    const seen=new Set(),out=[];
    function add(label,kind,replacement){
      if(out.length>=12)return;
      if(prefix&&!label.toLowerCase().startsWith(prefix.toLowerCase()))return;
      const key=kind+':'+label.toLowerCase();
      if(seen.has(key))return;
      seen.add(key);
      out.push({label,kind,insert:replacement,from,to:position});
    }
    for(const k of KEYWORDS)add(k,'keyword',k);
    for(const table of Array.isArray(options.tables)?options.tables:[]){
      if(!table||typeof table.name!=='string'||!table.name)continue;
      const prefix=table.schema?identifier(table.schema,options.dialect)+'.':'';
      add(table.name,table.type==='view'?'view':'table',prefix+identifier(table.name,options.dialect));
    }
    for(const col of Array.isArray(options.columns)?options.columns:[]){
      if(!col||typeof col.name!=='string'||!col.name)continue;
      add(col.name,'column',identifier(col.name,options.dialect));
    }
    return out;
  }
  global.NuBloxEditorTools=Object.freeze({suggestions,identifier,insideLiteral});
})(typeof window!=='undefined'?window:globalThis);

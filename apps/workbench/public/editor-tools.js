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

  const HIGHLIGHT_WORDS=new Set(KEYWORDS.flatMap(k=>k.split(' ')).concat([
    'TABLE','VIEW','INDEX','CREATE','ALTER','DROP','DELETE','INSERT','INTO',
    'PRIMARY','KEY','FOREIGN','REFERENCES','NULL','TRUE','FALSE','AND','OR',
    'EXISTS','CROSS','OUTER','FULL','UNION','EXCEPT','INTERSECT','RECURSIVE',
    'RETURNING','TOP','FETCH','NEXT','ROWS','ONLY','OFFSET','OVER','PARTITION'
  ]));
  const CLAUSE_BOUNDARY=new Set(['WHERE','ON','JOIN','LEFT','RIGHT','INNER',
    'FULL','CROSS','OUTER','GROUP','ORDER','HAVING','LIMIT','OFFSET',
    'UNION','INTERSECT','EXCEPT','SET','USING','RETURNING']);
  // Lossless highlighting lexer. Concatenating token.text must always return
  // the exact original SQL; the overlay never changes SQL sent to the server.
  function highlight(text,dialect){
    if(typeof text!=='string')return [];
    const result=[];
    const push=(start,end,kind)=>{
      if(end>start)result.push({text:text.slice(start,end),kind});
    };
    let i=0;
    while(i<text.length){
      const start=i, ch=text[i], next=text[i+1];
      if(/\s/.test(ch)){
        i++;
        while(i<text.length&&/\s/.test(text[i]))i++;
        push(start,i,'space');continue;
      }
      if(ch==='-'&&next==='-'||(ch==='#'&&dialect==='mysql')){
        i+=next==='-'?2:1;
        while(i<text.length&&text[i]!=='\n')i++;
        push(start,i,'comment');continue;
      }
      if(ch==='/'&&next==='*'){
        i+=2;
        while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;
        i=Math.min(text.length,i+(i<text.length?2:0));
        push(start,i,'comment');continue;
      }
      // PostgreSQL dollar-quoted strings, including tagged delimiters.
      if(ch==='
    options=options||{};
    if(typeof text!=='string'||!Number.isInteger(position)||position<0||position>text.length)return [];
    if(insideLiteral(text,position,options.dialect))return [];
    const before=text.slice(0,position);
    const word=before.match(/[A-Za-z_][A-Za-z0-9_$]*$/);
    const prefix=word?word[0]:'';
    const from=position-prefix.length;
    // A suffix must not be silently overwritten.
    if(position<text.length&&/[A-Za-z0-9_$]/.test(text[position]))return [];
    if(!prefix&&!options.manual&&!resolveColumnContext(text,position,options))return [];
    const qualified=resolveColumnContext(text,position,options);
    const seen=new Set(),out=[];
    function add(label,kind,replacement){
      if(out.length>=12)return;
      if(prefix&&!label.toLowerCase().startsWith(prefix.toLowerCase()))return;
      const key=kind+':'+label.toLowerCase();
      if(seen.has(key))return;
      seen.add(key);
      out.push({label,kind,insert:replacement,from,to:position});
    }
    if(!qualified)for(const k of KEYWORDS)add(k,'keyword',k);
    for(const table of qualified?[]:Array.isArray(options.tables)?options.tables:[]){
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
  global.NuBloxEditorTools=Object.freeze({suggestions,identifier,insideLiteral,highlight,resolveColumnContext});
})(typeof window!=='undefined'?window:globalThis);
&&dialect==='postgresql'){
        const tag=text.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
        if(tag){
          const close=text.indexOf(tag[0],i+tag[0].length);
          i=close===-1?text.length:close+tag[0].length;
          push(start,i,'string');continue;
        }
      }
      if(ch==="'"){
        i++;
        while(i<text.length){
          if(text[i]==='\\'&&dialect==='mysql'){i=Math.min(text.length,i+2);continue;}
          if(text[i]==="'"){
            if(text[i+1]==="'"){i+=2;continue;}
            i++;break;
          }
          i++;
        }
        push(start,i,'string');continue;
      }
      if(ch==='"'||(ch==='`'&&dialect==='mysql')||(ch==='['&&dialect==='sqlserver')){
        const closer=ch==='['?']':ch;
        i++;
        while(i<text.length){
          if(text[i]===closer){
            if(text[i+1]===closer){i+=2;continue;}
            i++;break;
          }
          i++;
        }
        push(start,i,'identifier');continue;
      }
      if(/[0-9]/.test(ch)){
        i++;
        while(i<text.length&&/[0-9._]/.test(text[i]))i++;
        if(/[eE]/.test(text[i]||'')&&/[+-]?[0-9]/.test(text.slice(i+1,i+3))){
          i++;if(/[+-]/.test(text[i]||''))i++;
          while(/[0-9]/.test(text[i]||''))i++;
        }
        push(start,i,'number');continue;
      }
      if(/[A-Za-z_]/.test(ch)){
        i++;
        while(i<text.length&&/[A-Za-z0-9_$]/.test(text[i]))i++;
        push(start,i,HIGHLIGHT_WORDS.has(text.slice(start,i).toUpperCase())?'keyword':'word');
        continue;
      }
      i++;push(start,i,'symbol');
    }
    return result;
  }
  function tokenName(token){
    if(token.kind==='word')return token.text;
    if(token.kind!=='identifier')return null;
    const raw=token.text;
    const closer=raw[0]==='['?']':raw[0];
    return raw.endsWith(closer)?
      raw.slice(1,-1).split(closer+closer).join(closer):null;
  }
  // Conservative FROM/JOIN alias recognition for simple query scopes.
  // Only objects actually returned by NuBloxSQL metadata can be completed.
  function resolveColumnContext(text,position,options){
    options=options||{};
    if(typeof text!=='string'||!Number.isInteger(position)||
       position<0||position>text.length||insideLiteral(text,position,options.dialect))return null;
    const before=text.slice(0,position);
    const typed=before.match(/([A-Za-z_][A-Za-z0-9_$]*)\.([A-Za-z_][A-Za-z0-9_$]*)?$/);
    if(!typed)return null;
    const qualifier=typed[1].toLowerCase();
    const tables=Array.isArray(options.tables)?options.tables:[];
    const all=highlight(text,options.dialect);
    // Keep scope bounded to the statement containing the cursor.
    let start=0,end=text.length,offset=0;
    for(const t of all){
      if(t.kind==='symbol'&&t.text===';'){
        if(offset+t.text.length<=position)start=offset+t.text.length;
        else if(offset>=position){end=offset;break;}
      }
      offset+=t.text.length;
    }
    const statement=text.slice(start,end);
    const tokens=highlight(statement,options.dialect).filter(t=>t.kind!=='space'&&t.kind!=='comment');
    for(let i=0;i<tokens.length;i++){
      const head=tokens[i];
      if(head.kind!=='keyword'||!['FROM','JOIN'].includes(head.text.toUpperCase()))continue;
      const part=tokens[i+1];
      if(!part||part.text==='(')continue;
      const first=tokenName(part);
      if(!first)continue;
      let schema=null,name=first,j=i+2;
      if(tokens[j]&&tokens[j].text==='.'&&tokens[j+1]&&tokenName(tokens[j+1])){
        schema=first;name=tokenName(tokens[j+1]);j+=2;
      }
      const table=tables.find(t=>t&&typeof t.name==='string'&&
        t.name.toLowerCase()===name.toLowerCase()&&
        (!schema||typeof t.schema==='string'&&t.schema.toLowerCase()===schema.toLowerCase()));
      if(!table)continue;
      if(tokens[j]&&tokens[j].text.toUpperCase()==='AS')j++;
      const candidate=tokens[j]&&tokenName(tokens[j]);
      const alias=candidate&&!CLAUSE_BOUNDARY.has(candidate.toUpperCase())?candidate:name;
      if(qualifier===alias.toLowerCase()||qualifier===name.toLowerCase())return table;
    }
    return null;
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

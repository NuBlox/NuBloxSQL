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
      if(ch==='$'&&dialect==='postgresql'){
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
  // Token offsets and depths track scope without treating comments, quoted
  // strings or PostgreSQL dollar-quoted bodies as executable SQL.
  function scopedTokens(text,dialect){
    let offset=0,depth=0;
    return highlight(text,dialect).map(function(t){
      const item={text:t.text,kind:t.kind,start:offset,end:offset+t.text.length,depth};
      offset=item.end;
      if(t.kind==='symbol'&&t.text==='(')depth++;
      if(t.kind==='symbol'&&t.text===')')depth=Math.max(0,depth-1);
      return item;
    }).filter(t=>t.kind!=='space'&&t.kind!=='comment');
  }
  function statementBounds(tokens,position,textLength){
    let start=0,end=textLength;
    for(const t of tokens){
      if(t.kind==='symbol'&&t.text===';'&&t.depth===0){
        if(t.end<=position)start=t.end;
        else if(t.start>=position){end=t.start;break;}
      }
    }
    return {start,end};
  }
  function projectedNames(tokens,start,end,depth){
    const first=tokens.findIndex(t=>t.start>=start&&t.start<end&&t.depth===depth&&t.text.toUpperCase()==='SELECT');
    if(first<0)return [];
    const pieces=[];let current=[];
    function finish(){
      if(!current.length)return;
      let candidate=null;
      const as=current.findIndex(t=>t.text.toUpperCase()==='AS');
      if(as>=0&&current[as+1])candidate=tokenName(current[as+1]);
      else if(current.length===1)candidate=tokenName(current[0]);
      else if(current.length===3&&current[1].text==='.')candidate=tokenName(current[2]);
      if(candidate)pieces.push({name:candidate});
      current=[];
    }
    for(let i=first+1;i<tokens.length;i++){
      const t=tokens[i];
      if(t.start>=end)break;
      if(t.depth!==depth)continue;
      if(['FROM','WHERE','GROUP','ORDER','HAVING','LIMIT','UNION'].includes(t.text.toUpperCase()))break;
      if(t.text===',')finish();
      else current.push(t);
    }
    finish();
    return pieces;
  }
  function commonTableExpressions(tokens,bounds){
    const ctes=[];
    let i=tokens.findIndex(t=>t.start>=bounds.start&&t.start<bounds.end&&t.depth===0&&t.text.toUpperCase()==='WITH');
    if(i<0)return ctes;
    i++;
    if(tokens[i]&&tokens[i].text.toUpperCase()==='RECURSIVE')i++;
    while(i<tokens.length){
      const entry=tokens[i];
      if(!entry||entry.start>=bounds.end||entry.depth!==0)break;
      const name=tokenName(entry);
      if(!name)break;
      i++;
      let declared=[];
      if(tokens[i]&&tokens[i].text==='('&&tokens[i].depth===0){
        i++;
        while(i<tokens.length&&tokens[i].depth===1&&tokens[i].text!==')'){
          const t=tokens[i];
          if(t.text!==','){
            const col=tokenName(t);
            if(col)declared.push({name:col});
          }
          i++;
        }
        if(!tokens[i]||tokens[i].text!==')')break;
        i++;
      }
      if(!tokens[i]||tokens[i].text.toUpperCase()!=='AS')break;
      i++;
      if(!tokens[i]||tokens[i].text!=='(')break;
      const open=tokens[i].start;i++;
      let close=-1;
      while(i<tokens.length){
        if(tokens[i].text===')'&&tokens[i].depth===1){close=tokens[i].start;i++;break;}
        i++;
      }
      if(close<0)break;
      if(!declared.length)declared=projectedNames(tokens,open+1,close,1);
      ctes.push({name,virtualColumns:declared,schema:null,virtual:true});
      if(!tokens[i]||tokens[i].text!==','||tokens[i].depth!==0)break;
      i++;
    }
    return ctes;
  }
  // Resolve an alias in the *nearest* SELECT scope. Correlated subqueries may
  // reference enclosing aliases; later statements and sibling scopes may not.
  function resolveColumnContext(text,position,options){
    options=options||{};
    if(typeof text!=='string'||!Number.isInteger(position)||
       position<0||position>text.length||insideLiteral(text,position,options.dialect))return null;
    const typed=text.slice(0,position).match(/([A-Za-z_][A-Za-z0-9_$]*)\.([A-Za-z_][A-Za-z0-9_$]*)?$/);
    if(!typed)return null;
    const qualifier=typed[1].toLowerCase();
    const tokens=scopedTokens(text,options.dialect);
    let depth=0,offset=0;
    for(const token of highlight(text,options.dialect)){
      const stop=offset+token.text.length;
      if(offset<position&&position<stop&&['string','comment','identifier'].includes(token.kind))return null;
      if(stop<=position&&token.kind==='symbol'){
        if(token.text==='(')depth++;
        else if(token.text===')')depth=Math.max(0,depth-1);
      }
      offset=stop;
    }
    const bounds=statementBounds(tokens,position,text.length);
    const tables=Array.isArray(options.tables)?options.tables:[];
    const ctes=commonTableExpressions(tokens,bounds);
    const objects=ctes.concat(tables);
    for(let scopeDepth=depth;scopeDepth>=0;scopeDepth--){
      let begin=bounds.start;
      let hasSelect=false;
      for(const t of tokens){
        if(t.start<bounds.start||t.start>=position)continue;
        if(t.depth===scopeDepth&&t.text.toUpperCase()==='SELECT'){
          begin=t.start;hasSelect=true;
        }
      }
      if(!hasSelect)continue;
      let end=bounds.end;
      for(const t of tokens){
        if(t.start<=position||t.start<begin)continue;
        if(t.depth<scopeDepth||(t.depth===scopeDepth&&
          (t.text.toUpperCase()==='UNION'||t.text.toUpperCase()==='INTERSECT'||t.text.toUpperCase()==='EXCEPT'))){
          end=t.start;break;
        }
      }
      for(let i=0;i<tokens.length;i++){
        const head=tokens[i];
        if(head.start<begin||head.start>=end||head.depth!==scopeDepth||
           !['FROM','JOIN'].includes(head.text.toUpperCase()))continue;
        const first=tokens[i+1];
        if(!first||first.text==='(')continue;
        let schema=null,name=tokenName(first),j=i+2;
        if(!name)continue;
        if(tokens[j]&&tokens[j].text==='.'&&tokens[j+1]&&tokenName(tokens[j+1])){
          schema=name;name=tokenName(tokens[j+1]);j+=2;
        }
        const table=objects.find(t=>t&&typeof t.name==='string'&&
          t.name.toLowerCase()===name.toLowerCase()&&
          (!schema||(t.schema||'').toLowerCase()===schema.toLowerCase()));
        if(!table)continue;
        if(tokens[j]&&tokens[j].text.toUpperCase()==='AS')j++;
        const candidate=tokens[j]&&tokenName(tokens[j]);
        const alias=candidate&&!CLAUSE_BOUNDARY.has(candidate.toUpperCase())&&
          tokens[j].depth===scopeDepth?candidate:name;
        if(qualifier===alias.toLowerCase()||qualifier===name.toLowerCase())return table;
      }
    }
    return null;
  }
  const CLAUSE_STARTS=new Set(['FROM','WHERE','HAVING','LIMIT','OFFSET',
    'JOIN','GROUP','ORDER','UNION','INTERSECT','EXCEPT','RETURNING']);
  // Conservative, non-destructive layout formatter. Only modifies whitespace
  // before top-level clause boundaries; preserves every SQL token verbatim.
  function formatSQL(text,dialect){
    if(typeof text!=='string')throw new TypeError('SQL must be a string');
    if(!text.trim())return text;
    const all=highlight(text,dialect);
    if(all.some(t=>t.kind==='comment')){
      throw new Error('Formatting statements with comments is not supported; SQL was left unchanged');
    }
    const tokens=scopedTokens(text,dialect);
    if(tokens.some(t=>t.kind==='symbol'&&t.text===';'&&t.depth===0&&
       tokens.some(next=>next.start>t.start&&next.kind!=='space'))){
      throw new Error('Format one SQL statement at a time; SQL was left unchanged');
    }
    const first=tokens[0];
    if(!first||!['SELECT','WITH','INSERT','UPDATE','DELETE'].includes(first.text.toUpperCase()))
      throw new Error('Formatting is currently supported for common SELECT and DML statements only');
    for(const t of all){
      if(t.kind!=='string'&&t.kind!=='identifier')continue;
      const opener=t.text[0],closer=opener==='['?']':opener;
      if((opener==="'"||opener==='"'||opener==='`'||opener==='[')&&
         !t.text.endsWith(closer))throw new Error('Unclosed SQL literal or identifier; SQL was left unchanged');
      if(opener==='$'&&dialect==='postgresql'){
        const tag=t.text.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
        if(tag&&!t.text.slice(tag[0].length).endsWith(tag[0]))throw new Error('Unclosed dollar string; SQL was left unchanged');
      }
    }
    const edits=[];
    for(const t of tokens){
      if(t.depth!==0||t.start<=first.start||t.kind!=='keyword'||
         !CLAUSE_STARTS.has(t.text.toUpperCase()))continue;
      let from=t.start;
      while(from>0&&/[ \t\r\n]/.test(text[from-1]))from--;
      if(from===t.start)continue; // never invent separators inside identifiers
      edits.push({start:from,end:t.start,value:'\n'});
    }
    let result=text;
    for(let i=edits.length-1;i>=0;i--){
      const e=edits[i];result=result.slice(0,e.start)+e.value+result.slice(e.end);
    }
    return result;
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
    for(const col of qualified&&qualified.virtual?qualified.virtualColumns:(Array.isArray(options.columns)?options.columns:[])){
      if(!col||typeof col.name!=='string'||!col.name)continue;
      add(col.name,'column',identifier(col.name,options.dialect));
    }
    return out;
  }
  global.NuBloxEditorTools=Object.freeze({suggestions,identifier,insideLiteral,highlight,resolveColumnContext,formatSQL});
})(typeof window!=='undefined'?window:globalThis);

'use strict';

var Tokenizer=require('./Tokenizer');
var Compiler=require('./Compiler');

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
  return Object.freeze(value);
}
function upper(value){return String(value||'').toUpperCase();}
function isWord(token,value){return !!token&&(token.type==='identifier'||token.type==='keyword')&&upper(token.value)===value;}
function isMergeChain(ast){return !!(ast&&ast.type==='MergeStatement'&&Array.isArray(ast.clauses));}
function parameterStyle(token){
  var raw=token&&token.raw||'';
  if(raw[0]==='$'&&/^\$\d+$/.test(raw))return 'numbered-dollar';
  if(raw[0]==='?'&&raw.length>1)return 'qmark-numbered';
  if(raw[0]===':'||raw[0]==='@'||(raw[0]==='$'&&!/^\$\d+$/.test(raw)))return 'named';
  return 'qmark';
}
function cloneWithParameterTokens(value,sourceParameters,state){
  if(Array.isArray(value))return value.map(function(entry){return cloneWithParameterTokens(entry,sourceParameters,state);});
  if(!value||typeof value!=='object')return value;
  if(value.type==='Parameter'){
    var source=sourceParameters[state.index++];
    if(!source)throw new RangeError('MERGE parameter-origin mapping is inconsistent');
    return {type:'Parameter',binding:source.value,style:parameterStyle(source)};
  }
  var result={};
  Object.keys(value).forEach(function(key){result[key]=cloneWithParameterTokens(value[key],sourceParameters,state);});
  return result;
}
function rebindParsed(value,sourceParameters){
  if(!sourceParameters.length)return value;
  var state={index:0};
  var result=cloneWithParameterTokens(value,sourceParameters,state);
  if(state.index!==sourceParameters.length)throw new RangeError('MERGE parser did not consume every source parameter marker');
  return result;
}
function fakeSelect(expressions){
  return {type:'SelectStatement',with:null,distinct:false,distinctOn:[],columns:expressions.slice(),from:null,joins:[],where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null};
}
function isVersionedMerge(ast){
  return isMergeChain(ast)&&((ast.returning&&ast.returning.length)||ast.clauses.some(function(clause){
    return clause.match==='not-matched-by-source'||clause.match==='not-matched-by-target';
  }));
}
function isRichMergeSource(ast){return !!(ast&&ast.source&&ast.source.type==='MutationSource');}
function scopeOf(ast){
  if(isRichMergeSource(ast))return 'dml-v10';
  return isVersionedMerge(ast)?'dml-v9':'dml-v8';
}

function create(baseApi,normalizeDialect,rewriteApi){
  function parseMergeChain(dialect,sql){
    var source=normalizeDialect(dialect);
    if(source!=='postgresql')return null;
    var tokens=Tokenizer.tokenize(sql,source),end=tokens.length-1,p=0;
    if(end>0&&tokens[end-1].type==='punctuation'&&tokens[end-1].value===';')end-=1;
    function peek(offset){return tokens[p+(offset||0)];}
    function take(){return tokens[p++];}
    function word(value,offset){return isWord(peek(offset),value);}
    function punctuation(value,offset){var t=peek(offset);return !!t&&t.type==='punctuation'&&t.value===value;}
    function fail(message,token){
      token=token||peek();
      var e=new SyntaxError(message+' at character '+(token?token.start:sql.length));
      e.position=token?token.start:sql.length;
      throw e;
    }
    function expectWord(value,message){if(!word(value))fail(message||('Expected '+value));return take();}
    function expectPunctuation(value,message){if(!punctuation(value))fail(message||('Expected '+value));return take();}
    function identifier(simple){
      var first=peek();
      if(!first||first.type!=='identifier')fail('Expected identifier',first);
      var parts=[take().value];
      while(punctuation('.')&&peek(1)&&peek(1).type==='identifier'){take();parts.push(take().value);}
      if(simple&&parts.length!==1)fail('Expected unqualified identifier',first);
      return {type:'Identifier',parts:parts};
    }
    function optionalAlias(){
      if(word('AS')){take();return identifier(true);}
      if(peek()&&peek().type==='identifier'&&!word('USING')&&!word('ON')&&!word('WHEN'))return identifier(true);
      return null;
    }
    function text(start,stop){
      if(stop<=start)fail('Expected SQL expression',tokens[start]);
      return sql.slice(tokens[start].start,tokens[stop-1].end);
    }
    function params(start,stop){return tokens.slice(start,stop).filter(function(t){return t.type==='parameter';});}
    function findWord(start,stop,value){
      var depth=0,caseDepth=0;
      for(var i=start;i<stop;i+=1){
        var t=tokens[i];
        if(t.type==='punctuation'&&t.value==='('){depth+=1;continue;}
        if(t.type==='punctuation'&&t.value===')'){depth-=1;continue;}
        if(depth!==0)continue;
        if(isWord(t,'CASE')){caseDepth+=1;continue;}
        if(isWord(t,'END')&&caseDepth>0){caseDepth-=1;continue;}
        if(caseDepth===0&&isWord(t,value))return i;
      }
      return -1;
    }
    function matchingParen(open,stop){
      var depth=0;
      for(var i=open;i<stop;i+=1){
        var t=tokens[i];
        if(t.type==='punctuation'&&t.value==='(')depth+=1;
        else if(t.type==='punctuation'&&t.value===')'){
          depth-=1;
          if(depth===0)return i;
        }
      }
      fail('Unclosed parenthesis',tokens[open]);
    }
    function parseExpression(start,stop){
      var parsed=baseApi.parseSql('postgresql','DELETE FROM __nublox_merge WHERE '+text(start,stop));
      parsed=rebindParsed(parsed,params(start,stop));
      return parsed.where;
    }
    function parseAssignments(start,stop){
      var parsed=baseApi.parseSql('postgresql','UPDATE __nublox_merge SET '+text(start,stop));
      parsed=rebindParsed(parsed,params(start,stop));
      return parsed.assignments;
    }
    function parseValues(start,stop){
      var parsed=baseApi.parseSql('postgresql','INSERT INTO __nublox_merge VALUES ('+text(start,stop)+')');
      parsed=rebindParsed(parsed,params(start,stop));
      return parsed.rows[0];
    }
    function parseReturning(start,stop){
      if(isWord(tokens[start],'WITH'))fail('dml-v9 does not yet support MERGE RETURNING WITH (OLD/NEW AS ...) output aliases',tokens[start]);
      var parsed=baseApi.parseSql('postgresql','DELETE FROM __nublox_merge RETURNING '+text(start,stop));
      parsed=rebindParsed(parsed,params(start,stop));
      return parsed.returning;
    }
    function parseColumns(){
      var columns=[];
      if(!punctuation('('))return columns;
      take();
      do{
        columns.push(identifier(true));
        if(!punctuation(','))break;
        take();
      }while(true);
      expectPunctuation(')','Expected ) after MERGE INSERT columns');
      return columns;
    }
    function parseMergeSource(){
      if(!punctuation('(')){
        return {source:identifier(false),alias:optionalAlias()};
      }
      var start=p;
      var close=matchingParen(start,end);
      p=close+1;
      var alias=optionalAlias();
      if(!alias)fail('dml-v10 MERGE query source requires an alias',tokens[start]);
      var stop=p;
      var sourceText=text(start,stop);
      var parsed=baseApi.parseSql('postgresql','SELECT * FROM '+sourceText);
      parsed=rebindParsed(parsed,params(start,stop));
      if(!parsed||parsed.type!=='SelectStatement'||!parsed.from||parsed.from.type!=='DerivedTable'){
        fail('dml-v10 requires a parenthesized SELECT query source',tokens[start]);
      }
      if(parsed.joins.length||parsed.where||parsed.groupBy.length||parsed.having||parsed.orderBy.length||parsed.limit||parsed.offset||parsed.with){
        fail('dml-v10 outer MERGE source must be exactly one parenthesized query relation',tokens[start]);
      }
      return {source:{type:'MutationSource',relation:parsed.from,joins:[]},alias:null};
    }
    function boundary(start,stop){
      var whenIndex=findWord(start,stop,'WHEN');
      var returningIndex=findWord(start,stop,'RETURNING');
      if(whenIndex<0)return returningIndex<0?stop:returningIndex;
      if(returningIndex<0)return whenIndex;
      return Math.min(whenIndex,returningIndex);
    }

    if(!word('MERGE'))return null;
    expectWord('MERGE');expectWord('INTO','MERGE requires INTO');
    var target=identifier(false);
    var targetAlias=optionalAlias();
    expectWord('USING','MERGE requires USING');
    var parsedSource=parseMergeSource();
    var mergeSource=parsedSource.source;
    var sourceAlias=parsedSource.alias;
    expectWord('ON','MERGE requires ON');
    var onStart=p;
    var firstWhen=findWord(p,end,'WHEN');
    if(firstWhen<0)return null;
    var returningIndex=findWord(firstWhen,end,'RETURNING');
    var clauseStop=returningIndex>=0?returningIndex:end;
    var on=parseExpression(onStart,firstWhen);
    p=firstWhen;
    var clauses=[];

    while(p<clauseStop){
      expectWord('WHEN');
      var match;
      if(word('MATCHED')){take();match='matched';}
      else{
        expectWord('NOT','MERGE action must be MATCHED or NOT MATCHED');
        expectWord('MATCHED');
        match='not-matched';
        if(word('BY')){
          take();
          if(word('SOURCE')){take();match='not-matched-by-source';}
          else if(word('TARGET')){take();match='not-matched-by-target';}
          else fail('MERGE BY qualifier must be SOURCE or TARGET');
        }
      }
      var thenIndex=findWord(p,clauseStop,'THEN');
      if(thenIndex<0)fail('MERGE WHEN clause requires THEN');
      var condition=null;
      if(word('AND')){
        take();
        condition=parseExpression(p,thenIndex);
        p=thenIndex;
      }else if(p!==thenIndex)fail('Unexpected MERGE WHEN clause tokens',peek());
      expectWord('THEN');
      var action;
      var targetSide=match==='not-matched'||match==='not-matched-by-target';
      var sourceSide=match==='not-matched-by-source';
      if(word('DO')){
        take();expectWord('NOTHING','MERGE DO requires NOTHING');
        action={type:'MergeDoNothingAction',action:'nothing'};
      }else if(word('DELETE')){
        if(targetSide)fail('NOT MATCHED [BY TARGET] supports INSERT or DO NOTHING');
        take();
        action={type:'MergeDeleteAction',action:'delete'};
      }else if(word('UPDATE')){
        if(targetSide)fail('NOT MATCHED [BY TARGET] supports INSERT or DO NOTHING');
        take();expectWord('SET','MERGE UPDATE requires SET');
        var updateEnd=boundary(p,clauseStop);
        action={type:'MergeUpdateAction',action:'update',assignments:parseAssignments(p,updateEnd)};
        p=updateEnd;
      }else if(word('INSERT')){
        if(!targetSide)fail((sourceSide?'NOT MATCHED BY SOURCE':'MATCHED')+' does not support INSERT');
        take();
        var columns=parseColumns();
        expectWord('VALUES','MERGE INSERT requires VALUES');
        expectPunctuation('(','MERGE INSERT VALUES requires (');
        var open=p-1;
        var close=matchingParen(open,clauseStop);
        var values=parseValues(p,close);
        p=close+1;
        action={type:'MergeInsertAction',action:'insert',columns:columns,values:values};
      }else fail('Unsupported MERGE action',peek());

      clauses.push({type:'MergeWhenClause',match:match,condition:condition,action:action});
      if(p<clauseStop&&!word('WHEN'))fail('Unexpected trailing MERGE action SQL',peek());
    }

    var returning=[];
    if(returningIndex>=0){
      p=returningIndex;
      expectWord('RETURNING');
      returning=parseReturning(p,end);
      p=end;
    }
    if(p!==end)fail('Unexpected trailing MERGE SQL',peek());

    if(!clauses.length)fail('MERGE requires at least one WHEN clause');
    var matchedCount=clauses.filter(function(clause){return clause.match==='matched';}).length;
    var targetCount=clauses.filter(function(clause){return clause.match==='not-matched'||clause.match==='not-matched-by-target';}).length;
    var versioned=returning.length||clauses.some(function(clause){return clause.match==='not-matched-by-source'||clause.match==='not-matched-by-target';});
    var usesActionChain=versioned||matchedCount>1||targetCount>1||clauses.some(function(clause){
      return !!clause.condition||clause.action.action==='nothing';
    });
    if(!usesActionChain)return null;
    return deepFreeze({
      type:'MergeStatement',target:target,targetAlias:targetAlias,source:mergeSource,sourceAlias:sourceAlias,on:on,
      matched:null,notMatched:null,clauses:clauses,returning:returning
    });
  }

  function identifierName(node){
    return node&&node.type==='Identifier'&&Array.isArray(node.parts)&&node.parts.length?String(node.parts[node.parts.length-1]).toLowerCase():null;
  }
  function validateAssignments(assignments,label){
    if(!Array.isArray(assignments)||!assignments.length)throw new TypeError(label+' requires assignments');
    var seen=Object.create(null);
    assignments.forEach(function(a){
      if(!a||a.type!=='Assignment'||!identifierName(a.column)||a.column.parts.length!==1)throw new TypeError(label+' assignment target must be an unqualified identifier');
      var name=identifierName(a.column);
      if(seen[name])throw new RangeError('Duplicate '+label+' assignment column: '+name);
      seen[name]=true;
      baseApi.analyzeAst(fakeSelect([a.value]));
    });
  }
  function familyKey(match){
    if(match==='not-matched'||match==='not-matched-by-target')return 'not-matched-target';
    return match;
  }
  function sourceQuery(source){
    return {
      type:'SelectStatement',with:null,distinct:false,distinctOn:[],
      columns:[{type:'Wildcard',qualifier:null}],from:source.relation,joins:source.joins,
      where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null
    };
  }
  function validateMergeSource(source){
    if(source&&source.type==='MutationSource'){
      if(!source.relation||source.relation.type!=='DerivedTable'||!Array.isArray(source.joins)){
        throw new TypeError('dml-v10 MERGE source must contain one derived query relation');
      }
      if(source.joins.length)throw new RangeError('dml-v10 MERGE outer source does not accept sibling joins; put joins inside the source query');
      baseApi.analyzeAst(sourceQuery(source));
      return;
    }
    if(!identifierName(source))throw new TypeError('MERGE source must be an identifier or query source');
  }
  function validate(ast){
    if(!isMergeChain(ast))throw new TypeError('Expected PostgreSQL MERGE action-chain AST');
    if(!identifierName(ast.target))throw new TypeError('MERGE requires a target identifier');
    validateMergeSource(ast.source);
    baseApi.analyzeAst(fakeSelect([ast.on]));
    var terminal={matched:false,'not-matched-target':false,'not-matched-by-source':false};
    ast.clauses.forEach(function(clause,index){
      if(!clause||clause.type!=='MergeWhenClause')throw new TypeError('Invalid MERGE WHEN clause at index '+index);
      if(['matched','not-matched','not-matched-by-source','not-matched-by-target'].indexOf(clause.match)<0)throw new RangeError('Invalid MERGE match family');
      var key=familyKey(clause.match);
      if(terminal[key])throw new RangeError('MERGE '+key+' clause is unreachable after an unconditional clause');
      if(clause.condition)baseApi.analyzeAst(fakeSelect([clause.condition]));
      else terminal[key]=true;
      if(!clause.action)throw new TypeError('MERGE WHEN clause requires an action');
      var targetSide=key==='not-matched-target';
      if(targetSide){
        if(clause.action.action==='insert'){
          if(!Array.isArray(clause.action.columns)||!Array.isArray(clause.action.values))throw new TypeError('MERGE INSERT action requires columns and values');
          if(clause.action.columns.length&&clause.action.columns.length!==clause.action.values.length)throw new RangeError('MERGE INSERT column/value width mismatch');
          if(clause.action.values.length)baseApi.analyzeAst(fakeSelect(clause.action.values));
        }else if(clause.action.action!=='nothing')throw new RangeError('NOT MATCHED [BY TARGET] supports INSERT or DO NOTHING');
      }else{
        if(clause.action.action==='update')validateAssignments(clause.action.assignments,'MERGE UPDATE');
        else if(clause.action.action!=='delete'&&clause.action.action!=='nothing')throw new RangeError('MATCHED/BY SOURCE supports UPDATE, DELETE or DO NOTHING');
      }
    });
    if(!Array.isArray(ast.returning))throw new TypeError('MERGE returning must be an array');
    if(ast.returning.length)baseApi.analyzeAst(fakeSelect(ast.returning));
    return ast;
  }
  function addCaps(set,expressions){
    if(!expressions||!expressions.length)return;
    baseApi.analyzeAst(fakeSelect(expressions)).capabilities.forEach(function(path){if(path!=='statements.select')set[path]=true;});
  }
  function analyzeAst(ast){
    if(!isMergeChain(ast))return baseApi.analyzeAst(ast);
    validate(ast);
    var set=Object.create(null);
    set['statements.merge']=true;
    if(isRichMergeSource(ast)){
      set['syntax.mergeQuerySource']=true;
      baseApi.analyzeAst(sourceQuery(ast.source)).capabilities.forEach(function(path){set[path]=true;});
    }
    if(ast.clauses.length>1)set['syntax.mergeMultipleWhen']=true;
    addCaps(set,[ast.on]);
    ast.clauses.forEach(function(clause){
      if(clause.match==='not-matched-by-source')set['syntax.mergeNotMatchedBySource']=true;
      if(clause.match==='not-matched-by-target')set['syntax.mergeNotMatchedByTarget']=true;
      if(clause.condition){set['syntax.mergeActionCondition']=true;addCaps(set,[clause.condition]);}
      if(clause.action.action==='nothing')set['syntax.mergeDoNothing']=true;
      if(clause.action.action==='update')clause.action.assignments.forEach(function(a){addCaps(set,[a.value]);});
      if(clause.action.action==='insert')addCaps(set,clause.action.values);
    });
    if(ast.returning.length){set['syntax.mergeReturning']=true;addCaps(set,ast.returning);}
    return deepFreeze({statementType:'MergeStatement',scope:scopeOf(ast),capabilities:Object.keys(set).sort()});
  }
  function quoteIdentifier(node){
    return node.parts.map(function(part){return Compiler.quoteIdentifier('postgresql',part);}).join('.');
  }
  function assembler(){
    var mapping=[];
    function add(compiled,fragment){
      var text=fragment===undefined?compiled.sql:fragment;
      var tokens=Tokenizer.tokenize(text,'postgresql'),out='',cursor=0;
      tokens.forEach(function(token){
        if(token.type!=='parameter')return;
        out+=text.slice(cursor,token.start);
        var binding=compiled.targetToSource[Number(token.value)-1];
        if(binding===undefined)throw new RangeError('MERGE compiled parameter mapping is inconsistent');
        mapping.push(binding);
        out+='$'+mapping.length;
        cursor=token.end;
      });
      return out+text.slice(cursor);
    }
    return {add:add,result:function(sql){return deepFreeze({dialect:'postgresql',sql:sql,targetToSource:mapping.slice()});}};
  }
  function expressionFragment(expr){
    var compiled=baseApi.compileAst('postgresql',{type:'DeleteStatement',target:{type:'Identifier',parts:['__nublox_merge']},where:expr,returning:[]});
    var marker=' WHERE ',index=compiled.sql.indexOf(marker);
    return {compiled:compiled,text:compiled.sql.slice(index+marker.length)};
  }
  function updateFragment(assignments){
    var compiled=baseApi.compileAst('postgresql',{type:'UpdateStatement',target:{type:'Identifier',parts:['__nublox_merge']},assignments:assignments,where:null,returning:[]});
    var marker=' SET ',index=compiled.sql.indexOf(marker);
    return {compiled:compiled,text:compiled.sql.slice(index+marker.length)};
  }
  function insertFragment(action){
    var compiled=baseApi.compileAst('postgresql',{type:'InsertStatement',target:{type:'Identifier',parts:['__nublox_merge']},columns:action.columns,rows:[action.values],source:null,returning:[]});
    var prefix='INSERT INTO '+Compiler.quoteIdentifier('postgresql','__nublox_merge');
    return {compiled:compiled,text:compiled.sql.slice(prefix.length)};
  }
  function sourceFragment(source){
    var compiled=baseApi.compileAst('postgresql',sourceQuery(source));
    var marker=' FROM ',index=compiled.sql.indexOf(marker);
    if(index<0)throw new Error('Unexpected dml-v10 MERGE source compiler output');
    return {compiled:compiled,text:compiled.sql.slice(index+marker.length)};
  }
  function returningFragment(expressions){
    var compiled=baseApi.compileAst('postgresql',{type:'DeleteStatement',target:{type:'Identifier',parts:['__nublox_merge']},where:null,returning:expressions});
    var marker=' RETURNING ',index=compiled.sql.indexOf(marker);
    if(index<0)throw new Error('Unexpected MERGE RETURNING compiler output');
    return {compiled:compiled,text:compiled.sql.slice(index+marker.length)};
  }
  function renderMatch(match){
    if(match==='matched')return 'MATCHED';
    if(match==='not-matched-by-source')return 'NOT MATCHED BY SOURCE';
    if(match==='not-matched-by-target')return 'NOT MATCHED BY TARGET';
    return 'NOT MATCHED';
  }
  function compileAst(dialect,ast){
    if(!isMergeChain(ast))return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    var scope=scopeOf(ast);
    if(target!=='postgresql')throw new RangeError(scope+' MERGE semantics are PostgreSQL-only');
    validate(ast);
    var out=assembler();
    var sql='MERGE INTO '+quoteIdentifier(ast.target);
    if(ast.targetAlias)sql+=' AS '+quoteIdentifier(ast.targetAlias);
    if(isRichMergeSource(ast)){
      var source=sourceFragment(ast.source);
      sql+=' USING '+out.add(source.compiled,source.text);
    }else{
      sql+=' USING '+quoteIdentifier(ast.source);
      if(ast.sourceAlias)sql+=' AS '+quoteIdentifier(ast.sourceAlias);
    }
    var on=expressionFragment(ast.on);
    sql+=' ON '+out.add(on.compiled,on.text);
    ast.clauses.forEach(function(clause){
      sql+=' WHEN '+renderMatch(clause.match);
      if(clause.condition){
        var condition=expressionFragment(clause.condition);
        sql+=' AND '+out.add(condition.compiled,condition.text);
      }
      sql+=' THEN ';
      if(clause.action.action==='nothing')sql+='DO NOTHING';
      else if(clause.action.action==='delete')sql+='DELETE';
      else if(clause.action.action==='update'){
        var update=updateFragment(clause.action.assignments);
        sql+='UPDATE SET '+out.add(update.compiled,update.text);
      }else{
        var insert=insertFragment(clause.action);
        sql+='INSERT'+out.add(insert.compiled,insert.text);
      }
    });
    if(ast.returning.length){
      var returning=returningFragment(ast.returning);
      sql+=' RETURNING '+out.add(returning.compiled,returning.text);
    }
    return out.result(sql);
  }
  function parseSql(dialect,sql){
    var source=normalizeDialect(dialect);
    var ast=parseMergeChain(source,sql);
    if(!ast)return baseApi.parseSql(source,sql);
    validate(ast);
    return ast;
  }
  function transpileSql(from,to,sql,options){
    options=options||{};
    var source=normalizeDialect(from),target=normalizeDialect(to);
    var ast=parseSql(source,sql);
    if(!isMergeChain(ast))return baseApi.transpileSql(source,target,sql,options);
    var scope=scopeOf(ast);
    if(source!=='postgresql'||target!=='postgresql')throw new RangeError(scope+' MERGE semantics are not automatically transpiled across dialects');
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true)throw new RangeError(scope+' MERGE transpilation is blocked by unsupported capabilities');
    if(plan.requiresQualification&&options.allowUnqualified!==true)throw new RangeError(scope+' MERGE transpilation requires runtime qualification');
    var compiled=compileAst(target,ast);
    var lossless=plan.decisions.every(function(entry){return entry.lossless!==false&&entry.action!=='emulate';});
    return deepFreeze({from:source,to:target,scope:scope,ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:compiled.targetToSource,lossless:lossless,certified:plan.safeToProceed&&lossless});
  }
  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}
exports.create=create;
exports.isMergeActionChainAst=isMergeChain;
exports.isVersionedMergeAst=isVersionedMerge;

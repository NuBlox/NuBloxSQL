'use strict';

var Tokenizer=require('./Tokenizer');
var Compiler=require('./Compiler');

var UPDATE_MODIFIERS=Object.freeze({LOW_PRIORITY:true,IGNORE:true});
var DELETE_MODIFIERS=Object.freeze({LOW_PRIORITY:true,QUICK:true,IGNORE:true});
var UPDATE_MODIFIER_RANK=Object.freeze({LOW_PRIORITY:1,IGNORE:2});
var DELETE_MODIFIER_RANK=Object.freeze({LOW_PRIORITY:1,QUICK:2,IGNORE:3});

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
  return Object.freeze(value);
}
function upper(value){return String(value||'').toUpperCase();}
function isWord(token,value){return !!token&&(token.type==='identifier'||token.type==='keyword')&&upper(token.value)===value;}
function isControlled(ast){
  return !!(ast&&(ast.type==='MysqlSingleTableUpdateStatement'||ast.type==='MysqlSingleTableDeleteStatement'||((ast.type==='MysqlMultiTableUpdateStatement'||ast.type==='MysqlMultiTableDeleteStatement')&&Array.isArray(ast.modifiers)&&ast.modifiers.length)));
}
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
    if(!source)throw new RangeError('dml-v7 parameter-origin mapping is inconsistent');
    return {type:'Parameter',binding:source.value,style:parameterStyle(source)};
  }
  var result={};
  Object.keys(value).forEach(function(key){result[key]=cloneWithParameterTokens(value[key],sourceParameters,state);});
  return result;
}
function rebindParsed(value,sourceParameters){
  if(!sourceParameters.length)return value;
  var state={index:0};
  var rebound=cloneWithParameterTokens(value,sourceParameters,state);
  if(state.index!==sourceParameters.length)throw new RangeError('dml-v7 did not consume every source parameter marker');
  return rebound;
}
function createBinder(){
  var targetToSource=[];
  return {
    marker:function(binding){targetToSource.push(binding);return '?';},
    targetToSource:targetToSource
  };
}
function fakeSelect(expressions){
  return {type:'SelectStatement',with:null,distinct:false,distinctOn:[],columns:expressions.slice(),from:null,joins:[],where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null};
}

function create(baseApi,normalizeDialect,rewriteApi){
  function parseMysql(sql){
    var tokens=Tokenizer.tokenize(sql,'mysql'),end=tokens.length-1,p=0;
    if(end>0&&tokens[end-1].type==='punctuation'&&tokens[end-1].value===';')end-=1;
    function peek(offset){return tokens[p+(offset||0)];}
    function take(){return tokens[p++];}
    function word(value,offset){return isWord(peek(offset),value);}
    function punctuation(value,offset){var t=peek(offset);return !!t&&t.type==='punctuation'&&t.value===value;}
    function fail(message,token){token=token||peek();var e=new SyntaxError(message+' at character '+(token?token.start:sql.length));e.position=token?token.start:sql.length;throw e;}
    function text(start,stop){if(stop<=start)fail('Expected SQL fragment',tokens[start]);return sql.slice(tokens[start].start,tokens[stop-1].end);}
    function params(start,stop){return tokens.slice(start,stop).filter(function(t){return t.type==='parameter';});}
    function findWord(start,stop,value){
      var depth=0;
      for(var i=start;i<stop;i+=1){
        var t=tokens[i];
        if(t.type==='punctuation'&&t.value==='(')depth+=1;
        else if(t.type==='punctuation'&&t.value===')')depth-=1;
        else if(depth===0&&isWord(t,value))return i;
      }
      return -1;
    }
    function firstClause(start,stop,names){
      var best=-1;
      names.forEach(function(name){var i=findWord(start,stop,name);if(i>=0&&(best<0||i<best))best=i;});
      return best;
    }
    function parseModifiers(kind){
      var allowed=kind==='update'?UPDATE_MODIFIERS:DELETE_MODIFIERS;
      var rank=kind==='update'?UPDATE_MODIFIER_RANK:DELETE_MODIFIER_RANK;
      var result=[],last=0;
      while(peek()&&(peek().type==='identifier'||peek().type==='keyword')&&allowed[upper(peek().value)]){
        var value=upper(take().value);
        if(result.indexOf(value)!==-1)fail('Duplicate MySQL mutation modifier '+value);
        if(rank[value]<last)fail('Invalid MySQL '+kind.toUpperCase()+' modifier order');
        last=rank[value];
        result.push(value);
      }
      return result;
    }
    function parseRelation(start,stop){
      var parsed=rebindParsed(baseApi.parseSql('mysql','SELECT * FROM '+text(start,stop)),params(start,stop));
      if(!parsed||parsed.type!=='SelectStatement'||!parsed.from||parsed.joins.length)fail('dml-v7 single-table mutation requires one table reference',tokens[start]);
      if(parsed.from.type!=='TableReference')fail('dml-v7 target must be a table reference',tokens[start]);
      return parsed.from;
    }
    function parseExpression(start,stop){
      var parsed=rebindParsed(baseApi.parseSql('mysql','SELECT '+text(start,stop)),params(start,stop));
      if(!parsed||parsed.type!=='SelectStatement'||parsed.columns.length!==1||parsed.from)fail('Invalid MySQL mutation expression',tokens[start]);
      if(parsed.columns[0].type==='AliasedExpression')fail('Mutation expression cannot have an alias',tokens[start]);
      return parsed.columns[0];
    }
    function splitTop(start,stop){
      var out=[],depth=0,segment=start;
      for(var i=start;i<stop;i+=1){
        var t=tokens[i];
        if(t.type==='punctuation'&&t.value==='(')depth+=1;
        else if(t.type==='punctuation'&&t.value===')')depth-=1;
        else if(depth===0&&t.type==='punctuation'&&t.value===','){out.push([segment,i]);segment=i+1;}
      }
      out.push([segment,stop]);return out;
    }
    function parseIdentifierRange(start,stop){
      var fragment=text(start,stop);
      var parsed=baseApi.parseSql('mysql','SELECT '+fragment);
      if(!parsed||parsed.type!=='SelectStatement'||parsed.columns.length!==1||parsed.from)fail('Expected identifier',tokens[start]);
      var id=parsed.columns[0];
      if(id.type!=='Identifier')fail('Expected identifier',tokens[start]);
      return id;
    }
    function parseAssignments(start,stop){
      return splitTop(start,stop).map(function(range){
        var depth=0,eq=-1;
        for(var i=range[0];i<range[1];i+=1){
          var t=tokens[i];
          if(t.type==='punctuation'&&t.value==='(')depth+=1;
          else if(t.type==='punctuation'&&t.value===')')depth-=1;
          else if(depth===0&&t.type==='operator'&&t.value==='='){eq=i;break;}
        }
        if(eq<=range[0]||eq>=range[1]-1)fail('UPDATE assignment requires identifier = expression',tokens[range[0]]);
        return {type:'Assignment',column:parseIdentifierRange(range[0],eq),value:parseExpression(eq+1,range[1])};
      });
    }
    function parseOrder(start,stop){
      var parsed=rebindParsed(baseApi.parseSql('mysql','SELECT 1 ORDER BY '+text(start,stop)),params(start,stop));
      return parsed.orderBy.slice();
    }
    function parseLimit(start,stop){
      var parsed=rebindParsed(baseApi.parseSql('mysql','SELECT 1 LIMIT '+text(start,stop)),params(start,stop));
      if(!parsed.limit||parsed.offset)fail('dml-v7 LIMIT requires one row-count expression',tokens[start]);
      return parsed.limit;
    }
    function finish(){
      if(p!==end)fail('Unexpected trailing MySQL mutation SQL');
      if(tokens[end]&&tokens[end].type==='punctuation'&&tokens[end].value===';')p+=1;
    }
    function strippedSql(modifierEnd){
      return sql.slice(0,tokens[1].start)+sql.slice(tokens[modifierEnd].start);
    }

    if(word('UPDATE')){
      take();
      var modifierStart=p,mods=parseModifiers('update'),modifierEnd=p;
      var setIndex=findWord(p,end,'SET');
      if(setIndex<0)return null;

      // Joined/multi-table UPDATE remains the dml-v6 AST, decorated only with
      // legal statement modifiers.
      var relationText=text(p,setIndex);
      var relationProbe=baseApi.parseSql('mysql','SELECT * FROM '+relationText);
      if(relationProbe&&relationProbe.type==='SelectStatement'&&relationProbe.joins.length){
        if(!mods.length)return null;
        var stripped=sql.slice(0,tokens[modifierStart].start)+sql.slice(tokens[modifierEnd].start);
        var multi=baseApi.parseSql('mysql',stripped);
        if(!multi||multi.type!=='MysqlMultiTableUpdateStatement')return null;
        return deepFreeze(Object.assign({},multi,{modifiers:mods}));
      }

      var target=parseRelation(p,setIndex),hasAlias=!!target.alias;
      p=setIndex+1;
      var assignmentEnd=firstClause(p,end,['WHERE','ORDER','LIMIT']);
      if(assignmentEnd<0)assignmentEnd=end;
      var assignments=parseAssignments(p,assignmentEnd);
      p=assignmentEnd;
      var where=null,orderBy=[],limit=null;
      if(word('WHERE')){
        take();var whereEnd=firstClause(p,end,['ORDER','LIMIT']);if(whereEnd<0)whereEnd=end;
        where=parseExpression(p,whereEnd);p=whereEnd;
      }
      if(word('ORDER')){
        take();if(!word('BY'))fail('ORDER requires BY');take();
        var orderEnd=findWord(p,end,'LIMIT');if(orderEnd<0)orderEnd=end;
        orderBy=parseOrder(p,orderEnd);p=orderEnd;
      }
      if(word('LIMIT')){take();limit=parseLimit(p,end);p=end;}
      finish();
      if(!mods.length&&!hasAlias&&!orderBy.length&&!limit)return null;
      return deepFreeze({type:'MysqlSingleTableUpdateStatement',target:target,modifiers:mods,assignments:assignments,where:where,orderBy:orderBy,limit:limit});
    }

    if(word('DELETE')){
      take();
      var dStart=p,dmods=parseModifiers('delete'),dEnd=p;

      // Decorate dml-v6 multi-table DELETE when a FROM/USING family follows.
      if(!word('FROM')){
        if(!dmods.length)return null;
        var dstripped=sql.slice(0,tokens[dStart].start)+sql.slice(tokens[dEnd].start);
        var dmulti=baseApi.parseSql('mysql',dstripped);
        if(!dmulti||dmulti.type!=='MysqlMultiTableDeleteStatement')return null;
        return deepFreeze(Object.assign({},dmulti,{modifiers:dmods}));
      }

      take();
      // DELETE FROM targets USING ... is multi-table. Let dml-v6 parse the
      // stripped statement and attach the modifiers here.
      var usingIndex=findWord(p,end,'USING');
      if(usingIndex>=0){
        if(!dmods.length)return null;
        var usingStripped=sql.slice(0,tokens[dStart].start)+sql.slice(tokens[dEnd].start);
        var usingMulti=baseApi.parseSql('mysql',usingStripped);
        if(!usingMulti||usingMulti.type!=='MysqlMultiTableDeleteStatement')return null;
        return deepFreeze(Object.assign({},usingMulti,{modifiers:dmods}));
      }

      var targetEnd=firstClause(p,end,['WHERE','ORDER','LIMIT']);
      if(targetEnd<0)targetEnd=end;
      var dtarget=parseRelation(p,targetEnd),dAlias=!!dtarget.alias;
      p=targetEnd;
      var dwhere=null,dorder=[],dlimit=null;
      if(word('WHERE')){
        take();var dwhereEnd=firstClause(p,end,['ORDER','LIMIT']);if(dwhereEnd<0)dwhereEnd=end;
        dwhere=parseExpression(p,dwhereEnd);p=dwhereEnd;
      }
      if(word('ORDER')){
        take();if(!word('BY'))fail('ORDER requires BY');take();
        var dorderEnd=findWord(p,end,'LIMIT');if(dorderEnd<0)dorderEnd=end;
        dorder=parseOrder(p,dorderEnd);p=dorderEnd;
      }
      if(word('LIMIT')){take();dlimit=parseLimit(p,end);p=end;}
      finish();
      if(!dmods.length&&!dAlias&&!dorder.length&&!dlimit)return null;
      return deepFreeze({type:'MysqlSingleTableDeleteStatement',target:dtarget,modifiers:dmods,where:dwhere,orderBy:dorder,limit:dlimit});
    }
    return null;
  }

  function validateIdentifier(node,label){
    if(!node||node.type!=='Identifier'||!Array.isArray(node.parts)||!node.parts.length)throw new TypeError(label+' must be an Identifier');
  }
  function validateModifiers(mods,allowed,label){
    if(!Array.isArray(mods))throw new TypeError(label+' modifiers must be an array');
    var seen=Object.create(null);
    mods.forEach(function(value){
      if(!allowed[value])throw new RangeError('Unsupported '+label+' modifier: '+value);
      if(seen[value])throw new RangeError('Duplicate '+label+' modifier: '+value);
      seen[value]=true;
    });
  }
  function validateTableReference(target){
    if(!target||target.type!=='TableReference')throw new TypeError('dml-v7 target must be a TableReference');
    validateIdentifier(target.name,'Mutation target');
    if(target.alias)validateIdentifier(target.alias,'Mutation target alias');
  }
  function validate(ast){
    if(!isControlled(ast))throw new TypeError('Expected dml-v7 MySQL mutation-control AST');
    if(ast.type==='MysqlMultiTableUpdateStatement'){
      validateModifiers(ast.modifiers,UPDATE_MODIFIERS,'UPDATE');
      baseApi.analyzeAst(Object.assign({},ast,{modifiers:[]}));
      return ast;
    }
    if(ast.type==='MysqlMultiTableDeleteStatement'){
      validateModifiers(ast.modifiers,DELETE_MODIFIERS,'DELETE');
      baseApi.analyzeAst(Object.assign({},ast,{modifiers:[]}));
      return ast;
    }
    validateTableReference(ast.target);
    validateModifiers(ast.modifiers,ast.type==='MysqlSingleTableUpdateStatement'?UPDATE_MODIFIERS:DELETE_MODIFIERS,ast.type==='MysqlSingleTableUpdateStatement'?'UPDATE':'DELETE');
    if(ast.type==='MysqlSingleTableUpdateStatement'){
      if(!Array.isArray(ast.assignments)||!ast.assignments.length)throw new TypeError('dml-v7 UPDATE requires assignments');
      ast.assignments.forEach(function(a){
        if(!a||a.type!=='Assignment')throw new TypeError('Invalid dml-v7 UPDATE assignment');
        validateIdentifier(a.column,'UPDATE assignment target');
        baseApi.analyzeAst(fakeSelect([a.value]));
      });
    }
    if(ast.where)baseApi.analyzeAst(fakeSelect([ast.where]));
    if(!Array.isArray(ast.orderBy))throw new TypeError('dml-v7 ORDER BY must be an array');
    if(ast.orderBy.length){
      var q=fakeSelect([{type:'Literal',value:1,raw:'1'}]);q.orderBy=ast.orderBy;
      baseApi.analyzeAst(q);
    }
    if(ast.limit)baseApi.analyzeAst(fakeSelect([ast.limit]));
    return ast;
  }
  function capabilityForModifier(kind,value){
    if(kind==='update')return value==='LOW_PRIORITY'?'syntax.mysqlUpdateLowPriority':'syntax.mysqlUpdateIgnore';
    if(value==='LOW_PRIORITY')return 'syntax.mysqlDeleteLowPriority';
    if(value==='QUICK')return 'syntax.mysqlDeleteQuick';
    return 'syntax.mysqlDeleteIgnore';
  }
  function analyzeAst(ast){
    if(!isControlled(ast))return baseApi.analyzeAst(ast);
    validate(ast);
    var set=Object.create(null),kind=ast.type.indexOf('Update')!==-1?'update':'delete';
    var base;
    if(ast.type==='MysqlMultiTableUpdateStatement'||ast.type==='MysqlMultiTableDeleteStatement'){
      base=baseApi.analyzeAst(Object.assign({},ast,{modifiers:[]}));
      base.capabilities.forEach(function(path){set[path]=true;});
    }else{
      set[kind==='update'?'statements.update':'statements.delete']=true;
      if(ast.target.alias)set['syntax.mysqlMutationTargetAlias']=true;
      if(ast.orderBy.length)set[kind==='update'?'syntax.mysqlUpdateOrderBy':'syntax.mysqlDeleteOrderBy']=true;
      if(ast.limit)set[kind==='update'?'syntax.mysqlUpdateLimit':'syntax.mysqlDeleteLimit']=true;
      if(ast.where)baseApi.analyzeAst(fakeSelect([ast.where])).capabilities.forEach(function(path){if(path!=='statements.select')set[path]=true;});
      if(kind==='update')ast.assignments.forEach(function(a){baseApi.analyzeAst(fakeSelect([a.value])).capabilities.forEach(function(path){if(path!=='statements.select')set[path]=true;});});
      if(ast.orderBy.length){var oq=fakeSelect([{type:'Literal',value:1,raw:'1'}]);oq.orderBy=ast.orderBy;baseApi.analyzeAst(oq).capabilities.forEach(function(path){if(path!=='statements.select'&&path!=='queries.ordering.orderBy')set[path]=true;});}
      if(ast.limit)baseApi.analyzeAst(fakeSelect([ast.limit])).capabilities.forEach(function(path){if(path!=='statements.select')set[path]=true;});
    }
    ast.modifiers.forEach(function(value){set[capabilityForModifier(kind,value)]=true;});
    return deepFreeze({statementType:ast.type,scope:'dml-v7',capabilities:Object.keys(set).sort()});
  }
  function quoteIdentifier(node){
    validateIdentifier(node,'Identifier');
    return node.parts.map(function(part){return Compiler.quoteIdentifier('mysql',part);}).join('.');
  }
  function tableSql(target){
    var sql=quoteIdentifier(target.name);
    if(target.alias)sql+=' AS '+quoteIdentifier(target.alias);
    return sql;
  }
  function compileFragment(ast,binder){
    var compiled=baseApi.compileAst('mysql',ast),tokens=Tokenizer.tokenize(compiled.sql,'mysql'),out='',cursor=0,occurrence=0;
    tokens.forEach(function(token){
      if(token.type!=='parameter')return;
      out+=compiled.sql.slice(cursor,token.start);
      var binding=compiled.targetToSource[occurrence++];
      if(binding===undefined)throw new RangeError('dml-v7 compiled parameter mapping is inconsistent');
      out+=binder.marker(binding);cursor=token.end;
    });
    return out+compiled.sql.slice(cursor);
  }
  function expressionSql(expr,binder){
    var rendered=compileFragment(fakeSelect([expr]),binder);
    if(rendered.slice(0,7)!=='SELECT ')throw new Error('Unexpected dml-v7 expression compiler output');
    return rendered.slice(7);
  }
  function orderSql(entries,binder){
    var q=fakeSelect([{type:'Literal',value:1,raw:'1'}]);q.orderBy=entries;
    var rendered=compileFragment(q,binder),marker=' ORDER BY ',index=rendered.indexOf(marker);
    if(index<0)throw new Error('Could not render dml-v7 ORDER BY');
    return rendered.slice(index+marker.length);
  }
  function modifierSql(mods){return mods.length?' '+mods.join(' '):'';}
  function compileAst(dialect,ast){
    if(!isControlled(ast))return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    if(target!=='mysql')throw new RangeError('MySQL mutation controls are only renderable for MySQL');
    validate(ast);
    if(ast.type==='MysqlMultiTableUpdateStatement'||ast.type==='MysqlMultiTableDeleteStatement'){
      var plain=Object.assign({},ast,{modifiers:[]});
      var compiled=baseApi.compileAst('mysql',plain);
      var prefix=ast.type==='MysqlMultiTableUpdateStatement'?'UPDATE':'DELETE';
      return deepFreeze({dialect:'mysql',sql:prefix+modifierSql(ast.modifiers)+compiled.sql.slice(prefix.length),targetToSource:compiled.targetToSource.slice()});
    }
    var binder=createBinder(),sql,kind=ast.type==='MysqlSingleTableUpdateStatement'?'update':'delete';
    if(kind==='update'){
      sql='UPDATE'+modifierSql(ast.modifiers)+' '+tableSql(ast.target)+' SET '+ast.assignments.map(function(a){return quoteIdentifier(a.column)+' = '+expressionSql(a.value,binder);}).join(', ');
    }else{
      sql='DELETE'+modifierSql(ast.modifiers)+' FROM '+tableSql(ast.target);
    }
    if(ast.where)sql+=' WHERE '+expressionSql(ast.where,binder);
    if(ast.orderBy.length)sql+=' ORDER BY '+orderSql(ast.orderBy,binder);
    if(ast.limit)sql+=' LIMIT '+expressionSql(ast.limit,binder);
    return deepFreeze({dialect:'mysql',sql:sql,targetToSource:binder.targetToSource.slice()});
  }
  function parseSql(dialect,sql){
    var source=normalizeDialect(dialect);
    if(source!=='mysql')return baseApi.parseSql(source,sql);
    var ast=parseMysql(sql);
    if(!ast)return baseApi.parseSql(source,sql);
    validate(ast);return ast;
  }
  function transpileSql(from,to,sql,options){
    options=options||{};
    var source=normalizeDialect(from),target=normalizeDialect(to),ast=parseSql(source,sql);
    if(!isControlled(ast))return baseApi.transpileSql(source,target,sql,options);
    if(source!=='mysql'||target!=='mysql')throw new RangeError('MySQL dml-v7 mutation controls are vendor-specific and are not automatically transpiled across dialects');
    var analysis=analyzeAst(ast),plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true)throw new RangeError('DML dml-v7 transpilation is blocked by unsupported target capabilities');
    var compiled=compileAst(target,ast);
    return deepFreeze({from:source,to:target,scope:'dml-v7',ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:compiled.targetToSource,lossless:true,certified:plan.safeToProceed});
  }
  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}
exports.create=create;
exports.isMysqlMutationControlAst=isControlled;

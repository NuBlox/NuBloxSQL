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
function isMysqlMultiTable(ast){
  return !!(ast&&(ast.type==='MysqlMultiTableUpdateStatement'||ast.type==='MysqlMultiTableDeleteStatement'));
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
    if(!source)throw new RangeError('dml-v6 parameter-origin mapping is inconsistent');
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
  if(state.index!==sourceParameters.length)throw new RangeError('dml-v6 did not consume every source parameter marker');
  return rebound;
}
function createBinder(dialect){
  var targetToSource=[],assigned=Object.create(null),next=1;
  function key(binding){return typeof binding+':'+String(binding);}
  function marker(binding){
    if(dialect==='mysql'){targetToSource.push(binding);return '?';}
    var k=key(binding);
    if(!assigned[k])assigned[k]=next++;
    var index=assigned[k];
    if(targetToSource[index-1]===undefined)targetToSource[index-1]=binding;
    return dialect==='postgresql'?'$'+index:'?'+index;
  }
  return {marker:marker,targetToSource:targetToSource};
}
function fakeSelect(expressions){
  return {type:'SelectStatement',with:null,distinct:false,distinctOn:[],columns:expressions.slice(),from:null,joins:[],where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null};
}
function sourceQuery(source){
  return {type:'SelectStatement',with:null,distinct:false,distinctOn:[],columns:[{type:'Wildcard',qualifier:null}],from:source.relation,joins:source.joins,where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null};
}
function create(baseApi,normalizeDialect,rewriteApi){
  function parse(dialect,sql){
    var source=normalizeDialect(dialect);
    if(source!=='mysql')return null;
    var tokens=Tokenizer.tokenize(sql,source),end=tokens.length-1;
    if(end>0&&tokens[end-1].type==='punctuation'&&tokens[end-1].value===';')end-=1;
    var p=0;
    function peek(offset){return tokens[p+(offset||0)];}
    function take(){return tokens[p++];}
    function word(value,offset){return isWord(peek(offset),value);}
    function punctuation(value,offset){var t=peek(offset);return !!t&&t.type==='punctuation'&&t.value===value;}
    function fail(message,token){token=token||peek();var e=new SyntaxError(message+' at character '+(token?token.start:sql.length));e.position=token?token.start:sql.length;throw e;}
    function identifier(){
      var first=peek();
      if(!first||first.type!=='identifier')fail('Expected identifier',first);
      var parts=[take().value];
      while(punctuation('.')&&peek(1)&&peek(1).type==='identifier'){take();parts.push(take().value);}
      return {type:'Identifier',parts:parts};
    }
    function text(start,stop){
      if(stop<=start)fail('Expected SQL fragment',tokens[start]);
      return sql.slice(tokens[start].start,tokens[stop-1].end);
    }
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
    function splitTop(start,stop){
      var out=[],depth=0,segment=start;
      for(var i=start;i<stop;i+=1){
        var t=tokens[i];
        if(t.type==='punctuation'&&t.value==='(')depth+=1;
        else if(t.type==='punctuation'&&t.value===')')depth-=1;
        else if(depth===0&&t.type==='punctuation'&&t.value===','){out.push([segment,i]);segment=i+1;}
      }
      out.push([segment,stop]);
      return out;
    }
    function parseRelation(start,stop){
      var parsed=baseApi.parseSql('mysql','SELECT * FROM '+text(start,stop));
      parsed=rebindParsed(parsed,params(start,stop));
      if(!parsed||parsed.type!=='SelectStatement'||!parsed.from)fail('Invalid MySQL table-reference graph',tokens[start]);
      if(parsed.where||parsed.groupBy.length||parsed.having||parsed.orderBy.length||parsed.limit||parsed.offset||parsed.with)fail('MySQL multi-table source may contain relations and joins only',tokens[start]);
      if(parsed.from.type!=='TableReference')fail('MySQL multi-table DML requires a base table reference',tokens[start]);
      return {type:'MutationSource',relation:parsed.from,joins:parsed.joins.slice()};
    }
    function parseExpression(start,stop){
      var parsed=baseApi.parseSql('mysql','SELECT '+text(start,stop));
      parsed=rebindParsed(parsed,params(start,stop));
      if(!parsed||parsed.type!=='SelectStatement'||parsed.columns.length!==1||parsed.from||parsed.where||parsed.groupBy.length||parsed.having||parsed.orderBy.length||parsed.limit||parsed.offset||parsed.with)fail('Invalid MySQL DML expression',tokens[start]);
      var value=parsed.columns[0];
      if(value.type==='AliasedExpression')fail('MySQL DML expression cannot have an alias',tokens[start]);
      return value;
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
        if(eq<=range[0]||eq>=range[1]-1)fail('MySQL multi-table UPDATE assignment requires identifier = expression',tokens[range[0]]);
        var save=p;p=range[0];var column=identifier();if(p!==eq)fail('MySQL multi-table UPDATE assignment target must be an identifier',tokens[range[0]]);p=save;
        return {type:'Assignment',column:column,value:parseExpression(eq+1,range[1])};
      });
    }
    function parseTargets(start,stop){
      return splitTop(start,stop).map(function(range){
        var save=p;p=range[0];var id=identifier();if(p!==range[1])fail('DELETE target must be a table identifier',tokens[range[0]]);p=save;return id;
      });
    }
    function finish(){
      if(p!==end)fail('Unexpected trailing MySQL multi-table DML');
      if(tokens[end]&&tokens[end].type==='punctuation'&&tokens[end].value===';')p+=1;
    }

    if(word('UPDATE')){
      take();
      var setIndex=findWord(p,end,'SET');
      if(setIndex<0)return null;
      var relation=parseRelation(p,setIndex);
      if(relation.joins.length===0)return null;
      p=setIndex+1;
      var whereIndex=findWord(p,end,'WHERE');
      var assignmentEnd=whereIndex>=0?whereIndex:end;
      var assignments=parseAssignments(p,assignmentEnd);
      p=assignmentEnd;
      var where=null;
      if(whereIndex>=0){take();where=parseExpression(p,end);p=end;}
      finish();
      return deepFreeze({type:'MysqlMultiTableUpdateStatement',source:relation,assignments:assignments,where:where});
    }

    if(word('DELETE')){
      take();
      if(word('FROM')){
        take();
        var usingIndex=findWord(p,end,'USING');
        if(usingIndex<0)return null;
        var targets=parseTargets(p,usingIndex);
        p=usingIndex+1;
        var usingWhere=findWord(p,end,'WHERE');
        var sourceStop=usingWhere>=0?usingWhere:end;
        var usingSource=parseRelation(p,sourceStop);
        p=sourceStop;
        var usingPredicate=null;
        if(usingWhere>=0){take();usingPredicate=parseExpression(p,end);p=end;}
        finish();
        return deepFreeze({type:'MysqlMultiTableDeleteStatement',syntax:'using',targets:targets,source:usingSource,where:usingPredicate});
      }
      var fromIndex=findWord(p,end,'FROM');
      if(fromIndex<0)return null;
      var targets2=parseTargets(p,fromIndex);
      p=fromIndex+1;
      var fromWhere=findWord(p,end,'WHERE');
      var sourceStop2=fromWhere>=0?fromWhere:end;
      var fromSource=parseRelation(p,sourceStop2);
      p=sourceStop2;
      var predicate=null;
      if(fromWhere>=0){take();predicate=parseExpression(p,end);p=end;}
      finish();
      return deepFreeze({type:'MysqlMultiTableDeleteStatement',syntax:'from',targets:targets2,source:fromSource,where:predicate});
    }
    return null;
  }

  function validateIdentifier(node,label){
    if(!node||node.type!=='Identifier'||!Array.isArray(node.parts)||!node.parts.length)throw new TypeError(label+' must be an Identifier');
  }
  function validateSource(source){
    if(!source||source.type!=='MutationSource'||!source.relation||!Array.isArray(source.joins))throw new TypeError('MySQL multi-table source must be a MutationSource');
    if(source.relation.type!=='TableReference')throw new TypeError('MySQL multi-table source requires a base table reference');
    if(source.joins.length===0)throw new TypeError('MySQL multi-table source requires at least one JOIN');
    baseApi.analyzeAst(sourceQuery(source));
  }
  function validate(ast){
    if(!isMysqlMultiTable(ast))throw new TypeError('Expected MySQL multi-table DML AST');
    validateSource(ast.source);
    if(ast.type==='MysqlMultiTableUpdateStatement'){
      if(!Array.isArray(ast.assignments)||ast.assignments.length===0)throw new TypeError('MySQL multi-table UPDATE requires assignments');
      ast.assignments.forEach(function(a){
        if(!a||a.type!=='Assignment')throw new TypeError('Invalid MySQL multi-table UPDATE assignment');
        validateIdentifier(a.column,'Assignment target');
        baseApi.analyzeAst(fakeSelect([a.value]));
      });
    }else{
      if(ast.syntax!=='from'&&ast.syntax!=='using')throw new RangeError('Unsupported MySQL multi-table DELETE syntax');
      if(!Array.isArray(ast.targets)||ast.targets.length===0)throw new TypeError('MySQL multi-table DELETE requires at least one target');
      ast.targets.forEach(function(t){validateIdentifier(t,'DELETE target');});
    }
    if(ast.where)baseApi.analyzeAst(fakeSelect([ast.where]));
    return ast;
  }
  function addCapabilities(set,analysis){
    analysis.capabilities.forEach(function(path){if(path!=='statements.select')set[path]=true;});
  }
  function analyzeAst(ast){
    if(!isMysqlMultiTable(ast))return baseApi.analyzeAst(ast);
    validate(ast);
    var set=Object.create(null);
    set[ast.type==='MysqlMultiTableUpdateStatement'?'statements.update':'statements.delete']=true;
    set[ast.type==='MysqlMultiTableUpdateStatement'?'syntax.multiTableUpdate':'syntax.multiTableDelete']=true;
    addCapabilities(set,baseApi.analyzeAst(sourceQuery(ast.source)));
    if(ast.type==='MysqlMultiTableUpdateStatement')ast.assignments.forEach(function(a){addCapabilities(set,baseApi.analyzeAst(fakeSelect([a.value])));});
    if(ast.where)addCapabilities(set,baseApi.analyzeAst(fakeSelect([ast.where])));
    return deepFreeze({statementType:ast.type,scope:'dml-v6',capabilities:Object.keys(set).sort()});
  }
  function quoteIdentifier(node){
    validateIdentifier(node,'Identifier');
    return node.parts.map(function(part){return Compiler.quoteIdentifier('mysql',part);}).join('.');
  }
  function compileFragment(ast,binder){
    var compiled=baseApi.compileAst('mysql',ast),tokens=Tokenizer.tokenize(compiled.sql,'mysql'),out='',cursor=0,occurrence=0;
    tokens.forEach(function(token){
      if(token.type!=='parameter')return;
      out+=compiled.sql.slice(cursor,token.start);
      var binding=compiled.targetToSource[occurrence++];
      if(binding===undefined)throw new RangeError('dml-v6 compiled parameter mapping is inconsistent');
      out+=binder.marker(binding);
      cursor=token.end;
    });
    return out+compiled.sql.slice(cursor);
  }
  function sourceSql(source,binder){
    var rendered=compileFragment(sourceQuery(source),binder);
    var marker=' FROM ',index=rendered.indexOf(marker);
    if(index<0)throw new Error('Could not render MySQL multi-table relation graph');
    return rendered.slice(index+marker.length);
  }
  function expressionSql(expr,binder){
    var rendered=compileFragment(fakeSelect([expr]),binder);
    if(rendered.slice(0,7)!=='SELECT ')throw new Error('Unexpected expression compiler output');
    return rendered.slice(7);
  }
  function compileAst(dialect,ast){
    if(!isMysqlMultiTable(ast))return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    if(target!=='mysql')throw new RangeError('MySQL multi-table UPDATE/DELETE dml-v6 is only renderable for MySQL');
    validate(ast);
    var binder=createBinder('mysql'),sql;
    if(ast.type==='MysqlMultiTableUpdateStatement'){
      sql='UPDATE '+sourceSql(ast.source,binder)+' SET '+ast.assignments.map(function(a){return quoteIdentifier(a.column)+' = '+expressionSql(a.value,binder);}).join(', ');
      if(ast.where)sql+=' WHERE '+expressionSql(ast.where,binder);
    }else{
      var targets=ast.targets.map(quoteIdentifier).join(', ');
      if(ast.syntax==='using')sql='DELETE FROM '+targets+' USING '+sourceSql(ast.source,binder);
      else sql='DELETE '+targets+' FROM '+sourceSql(ast.source,binder);
      if(ast.where)sql+=' WHERE '+expressionSql(ast.where,binder);
    }
    return deepFreeze({dialect:'mysql',sql:sql,targetToSource:binder.targetToSource.slice()});
  }
  function parseSql(dialect,sql){
    var source=normalizeDialect(dialect);
    var ast=parse(source,sql);
    if(!ast)return baseApi.parseSql(source,sql);
    validate(ast);
    return ast;
  }
  function transpileSql(from,to,sql,options){
    options=options||{};
    var source=normalizeDialect(from),target=normalizeDialect(to);
    var ast=parseSql(source,sql);
    if(!isMysqlMultiTable(ast))return baseApi.transpileSql(source,target,sql,options);
    if(source!=='mysql'||target!=='mysql')throw new RangeError('MySQL multi-table DML is a vendor-specific dml-v6 family and is not automatically transpiled across dialects');
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true)throw new RangeError('DML dml-v6 transpilation is blocked by unsupported target capabilities');
    var compiled=compileAst(target,ast);
    return deepFreeze({from:source,to:target,scope:'dml-v6',ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:compiled.targetToSource,lossless:true,certified:plan.safeToProceed});
  }
  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}
exports.create=create;
exports.isMysqlMultiTableDmlAst=isMysqlMultiTable;

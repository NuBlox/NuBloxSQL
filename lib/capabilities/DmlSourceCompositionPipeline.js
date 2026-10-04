'use strict';

var Tokenizer=require('./Tokenizer');

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
  return Object.freeze(value);
}
function upper(value){return String(value||'').toUpperCase();}
function isWord(token,value){return !!token&&(token.type==='identifier'||token.type==='keyword')&&upper(token.value)===value;}
function isRichSource(value){return !!(value&&value.type==='MutationSource');}
function isRichDml(ast){
  return !!(ast&&((ast.type==='UpdateStatement'&&isRichSource(ast.from))||(ast.type==='DeleteStatement'&&isRichSource(ast.using))));
}
function cloneWithoutSource(ast){
  var copy={};
  Object.keys(ast).forEach(function(key){
    if(key!=='from'&&key!=='using')copy[key]=ast[key];
  });
  return copy;
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
    if(!source)throw new RangeError('dml-v5 parameter-origin mapping is inconsistent');
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
  if(state.index!==sourceParameters.length)throw new RangeError('dml-v5 did not consume every source parameter marker');
  return rebound;
}
function containsParameter(value){
  if(!value||typeof value!=='object')return false;
  if(value.type==='Parameter')return true;
  if(Array.isArray(value))return value.some(containsParameter);
  return Object.keys(value).some(function(key){return containsParameter(value[key]);});
}
function createBinder(dialect){
  var targetToSource=[];
  var assigned=Object.create(null);
  var next=1;
  function key(binding){return typeof binding+':'+String(binding);}
  function marker(binding){
    if(dialect==='mysql'){
      targetToSource.push(binding);
      return '?';
    }
    var k=key(binding);
    if(!assigned[k])assigned[k]=next++;
    var index=assigned[k];
    if(targetToSource[index-1]===undefined)targetToSource[index-1]=binding;
    return dialect==='postgresql'?'$'+index:'?'+index;
  }
  return {marker:marker,targetToSource:targetToSource};
}
function rebindCompiledSql(sql,compiled,dialect,binder,state){
  var tokens=Tokenizer.tokenize(sql,dialect),output='',cursor=0;
  state=state||{mysqlOccurrence:0};
  tokens.forEach(function(token){
    if(token.type!=='parameter')return;
    output+=sql.slice(cursor,token.start);
    var binding;
    if(dialect==='mysql')binding=compiled.targetToSource[state.mysqlOccurrence++];
    else binding=compiled.targetToSource[Number(token.value)-1];
    if(binding===undefined)throw new RangeError('dml-v5 compiled parameter mapping is inconsistent');
    output+=binder.marker(binding);
    cursor=token.end;
  });
  return output+sql.slice(cursor);
}
function topLevelClause(sql,dialect,keyword){
  var tokens=Tokenizer.tokenize(sql,dialect),depth=0;
  for(var i=0;i<tokens.length;i+=1){
    var token=tokens[i];
    if(token.type==='punctuation'&&token.value==='('){depth+=1;continue;}
    if(token.type==='punctuation'&&token.value===')'){depth-=1;continue;}
    if(depth===0&&isWord(token,keyword))return {tokens:tokens,index:i,token:token};
  }
  return null;
}
function clauseEnd(tokens,start){
  var depth=0;
  for(var i=start;i<tokens.length;i+=1){
    var token=tokens[i];
    if(token.type==='punctuation'&&token.value==='('){depth+=1;continue;}
    if(token.type==='punctuation'&&token.value===')'){depth-=1;continue;}
    if(depth===0&&(isWord(token,'WHERE')||isWord(token,'RETURNING')||token.type==='eof'||(token.type==='punctuation'&&token.value===';')))return token;
  }
  return tokens[tokens.length-1];
}
function splitBeforeTail(sql,dialect){
  var tokens=Tokenizer.tokenize(sql,dialect),depth=0;
  for(var i=0;i<tokens.length;i+=1){
    var token=tokens[i];
    if(token.type==='punctuation'&&token.value==='('){depth+=1;continue;}
    if(token.type==='punctuation'&&token.value===')'){depth-=1;continue;}
    if(depth===0&&(isWord(token,'WHERE')||isWord(token,'RETURNING'))){
      return {head:sql.slice(0,token.start).replace(/\s+$/,''),tail:' '+sql.slice(token.start)};
    }
  }
  return {head:sql,tail:''};
}

function create(baseApi,normalizeDialect,rewriteApi){
  function parseRichSource(source,text,sourceParameters){
    var query=baseApi.parseSql(source,'SELECT * FROM '+text);
    query=rebindParsed(query,sourceParameters);
    if(!query||query.type!=='SelectStatement'||!query.from)throw new RangeError('dml-v4 requires a valid auxiliary relation');
    if(query.where||query.groupBy.length||query.having||query.orderBy.length||query.limit||query.offset||query.with){
      throw new RangeError('dml-v4 auxiliary source may contain relations and joins only');
    }
    var rich=query.from.type==='DerivedTable'||query.joins.length>0;
    if(!rich)return null;
    return {type:'MutationSource',relation:query.from,joins:query.joins.slice()};
  }
  function parseAdvanced(source,sql,type,keyword){
    var found=topLevelClause(sql,source,keyword);
    if(!found)return null;
    var end=clauseEnd(found.tokens,found.index+1);
    var sourceText=sql.slice(found.token.end,end.start).trim();
    if(!sourceText)throw new SyntaxError(keyword+' requires an auxiliary source');
    var sourceParameters=found.tokens.filter(function(token){
      return token.type==='parameter'&&token.start>=found.token.end&&token.end<=end.start;
    });
    var mutationSource=parseRichSource(source,sourceText,sourceParameters);
    if(!mutationSource)return null;
    var baseParameters=found.tokens.filter(function(token){
      return token.type==='parameter'&&(token.end<=found.token.start||token.start>=end.start);
    });
    var stripped=(sql.slice(0,found.token.start)+sql.slice(end.start)).replace(/\s+/g,' ').trim();
    var base=rebindParsed(baseApi.parseSql(source,stripped),baseParameters);
    if(!base||base.type!==type)return null;
    var copy=Object.assign({},base);
    if(type==='UpdateStatement')copy.from=mutationSource;
    else copy.using=mutationSource;
    return copy;
  }
  function parseSql(dialect,sql){
    var source=normalizeDialect(dialect),trimmed=String(sql||'').trim(),ast=null;
    if(/^UPDATE\b/i.test(trimmed))ast=parseAdvanced(source,sql,'UpdateStatement','FROM');
    else if(/^DELETE\b/i.test(trimmed))ast=parseAdvanced(source,sql,'DeleteStatement','USING');
    if(!ast)return baseApi.parseSql(source,sql);
    validate(ast,source);
    return deepFreeze(ast);
  }
  function sourceQuery(source){
    return {
      type:'SelectStatement',with:null,distinct:false,distinctOn:[],
      columns:[{type:'Wildcard',qualifier:null}],from:source.relation,joins:source.joins,
      where:null,groupBy:[],having:null,windows:[],orderBy:[],limit:null,offset:null
    };
  }
  function validateSourceNode(source,label){
    if(!isRichSource(source))throw new TypeError(label+' must be a MutationSource');
    if(!source.relation||!Array.isArray(source.joins))throw new TypeError(label+' requires relation and joins');
    if(source.relation.type!=='TableReference'&&source.relation.type!=='DerivedTable')throw new TypeError(label+' relation must be table or derived table');
    if(source.relation.type==='DerivedTable'&&!source.relation.alias)throw new TypeError(label+' derived table requires an alias');
    source.joins.forEach(function(join){
      if(!join||join.type!=='Join')throw new TypeError(label+' joins must be Join nodes');
    });
    baseApi.analyzeAst(sourceQuery(source));
  }
  function validate(ast,sourceDialect){
    if(!isRichDml(ast))throw new TypeError('NuBloxSQL dml-v4 AST requires a rich UPDATE FROM or DELETE USING source');
    baseApi.analyzeAst(cloneWithoutSource(ast));
    var source=ast.type==='UpdateStatement'?ast.from:ast.using;
    validateSourceNode(source,ast.type==='UpdateStatement'?'UPDATE FROM source':'DELETE USING source');
    if(ast.type==='UpdateStatement'&&sourceDialect==='mysql'){
      throw new SyntaxError('MySQL multi-table UPDATE is a distinct semantic family; PostgreSQL/SQLite UPDATE FROM composition is not valid MySQL source syntax');
    }
    if(ast.type==='DeleteStatement'&&sourceDialect&&sourceDialect!=='postgresql'){
      throw new SyntaxError('DELETE USING composition in dml-v4 is PostgreSQL source syntax');
    }
    return ast;
  }
  function analyzeAst(ast){
    if(!isRichDml(ast))return baseApi.analyzeAst(ast);
    validate(ast,null);
    var base=baseApi.analyzeAst(cloneWithoutSource(ast));
    var source=ast.type==='UpdateStatement'?ast.from:ast.using;
    var relationAnalysis=baseApi.analyzeAst(sourceQuery(source));
    var set=Object.create(null);
    base.capabilities.forEach(function(path){set[path]=true;});
    relationAnalysis.capabilities.forEach(function(path){set[path]=true;});
    set[ast.type==='UpdateStatement'?'syntax.updateFrom':'syntax.deleteUsing']=true;
    return deepFreeze({statementType:ast.type,scope:containsParameter(source)?'dml-v5':'dml-v4',capabilities:Object.keys(set).sort()});
  }
  function validateTarget(target,ast){
    if(ast.type==='UpdateStatement'){
      if(target==='mysql')throw new RangeError('MySQL multi-table UPDATE is not losslessly identical to PostgreSQL/SQLite UPDATE FROM composition');
    }else if(target!=='postgresql'){
      throw new RangeError('DELETE USING composition is only qualified for PostgreSQL in dml-v4');
    }
  }
  function compileSource(target,source){
    var compiled=baseApi.compileAst(target,sourceQuery(source));
    var marker=' FROM ',index=compiled.sql.indexOf(marker);
    if(index<0)throw new Error('dml-v4 could not render auxiliary source');
    return {sql:compiled.sql.slice(index+marker.length),compiled:compiled};
  }
  function compileAst(dialect,ast){
    if(!isRichDml(ast))return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    validate(ast,null);validateTarget(target,ast);
    var source=ast.type==='UpdateStatement'?ast.from:ast.using;
    var baseCompiled=baseApi.compileAst(target,cloneWithoutSource(ast));
    var sourceCompiled=compileSource(target,source);
    var split=splitBeforeTail(baseCompiled.sql,target);
    var binder=createBinder(target);
    var baseState={mysqlOccurrence:0};
    var sourceState={mysqlOccurrence:0};
    var head=rebindCompiledSql(split.head,baseCompiled,target,binder,baseState);
    var sourceSql=rebindCompiledSql(sourceCompiled.sql,sourceCompiled.compiled,target,binder,sourceState);
    var tail=rebindCompiledSql(split.tail,baseCompiled,target,binder,baseState);
    var clause=(ast.type==='UpdateStatement'?' FROM ':' USING ')+sourceSql;
    return deepFreeze({dialect:target,sql:head+clause+tail,targetToSource:binder.targetToSource.slice()});
  }
  function transpileSql(from,to,sql,options){
    options=options||{};
    var sourceDialect=normalizeDialect(from),target=normalizeDialect(to);
    var ast=parseSql(sourceDialect,sql);
    if(!isRichDml(ast))return baseApi.transpileSql(sourceDialect,target,sql,options);
    validate(ast,sourceDialect);
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(sourceDialect,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true){
      var blocked=plan.decisions.filter(function(entry){return entry.action==='reject';}).map(function(entry){return entry.path;});
      throw new RangeError('DML '+analysis.scope+' transpilation is blocked by unsupported target capabilities: '+blocked.join(', '));
    }
    if(plan.requiresQualification&&options.allowUnqualified!==true){
      var unresolved=plan.decisions.filter(function(entry){return entry.action==='qualify';}).map(function(entry){return entry.path;});
      throw new RangeError('DML '+analysis.scope+' transpilation requires runtime qualification for: '+unresolved.join(', '));
    }
    if(plan.decisions.some(function(entry){return entry.action==='emulate'||entry.action==='rewrite';})){
      throw new RangeError('DML '+analysis.scope+' transpilation requires an explicit semantic transformation');
    }
    validateTarget(target,ast);
    var compiled=compileAst(target,ast);
    var lossless=plan.decisions.every(function(entry){return entry.lossless!==false&&entry.action!=='emulate';});
    return deepFreeze({from:sourceDialect,to:target,scope:analysis.scope,ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:compiled.targetToSource,lossless:lossless,certified:plan.safeToProceed&&lossless});
  }
  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}
exports.create=create;
exports.isRichDmlAst=isRichDml;

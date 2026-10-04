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
function isAdvanced(ast){
  return !!(ast&&((ast.type==='UpdateStatement'&&ast.from)||(ast.type==='DeleteStatement'&&ast.using)));
}
function cloneWithoutAdvanced(ast){
  var copy={};
  Object.keys(ast).forEach(function(key){
    if(key!=='from'&&key!=='using')copy[key]=ast[key];
  });
  return copy;
}
function topLevelClause(sql,dialect,keyword){
  var tokens=Tokenizer.tokenize(sql,dialect);
  var depth=0;
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
function relationFromText(baseApi,dialect,text){
  var query=baseApi.parseSql(dialect,'SELECT * FROM '+text);
  if(!query||query.type!=='SelectStatement'||!query.from||query.from.type!=='TableReference'||query.joins.length){
    throw new RangeError('dml-v3 currently supports one auxiliary table reference with an optional alias');
  }
  if(query.where||query.groupBy.length||query.having||query.orderBy.length||query.limit||query.offset){
    throw new RangeError('dml-v3 auxiliary relation contains unsupported query clauses');
  }
  return query.from;
}
function relationSql(dialect,relation){
  var sql=relation.name.parts.map(function(part){return Compiler.quoteIdentifier(dialect,part);}).join('.');
  if(relation.alias)sql+=' AS '+relation.alias.parts.map(function(part){return Compiler.quoteIdentifier(dialect,part);}).join('.');
  return sql;
}
function insertBeforeTail(sql,clause){
  var where=sql.indexOf(' WHERE ');
  var returning=sql.indexOf(' RETURNING ');
  var index=where>=0&&returning>=0?Math.min(where,returning):where>=0?where:returning;
  if(index<0)return sql+clause;
  return sql.slice(0,index)+clause+sql.slice(index);
}

function create(baseApi,normalizeDialect,rewriteApi){
  function parseAdvanced(source,sql,type,keyword){
    var found=topLevelClause(sql,source,keyword);
    if(!found)return null;
    var end=clauseEnd(found.tokens,found.index+1);
    var relationText=sql.slice(found.token.end,end.start).trim();
    if(!relationText)throw new SyntaxError(keyword+' requires an auxiliary relation');
    var stripped=(sql.slice(0,found.token.start)+sql.slice(end.start)).replace(/\s+/g,' ').trim();
    var base=baseApi.parseSql(source,stripped);
    if(!base||base.type!==type)return null;
    var relation=relationFromText(baseApi,source,relationText);
    var copy=Object.assign({},base);
    if(type==='UpdateStatement')copy.from=relation;
    else copy.using=relation;
    return copy;
  }
  function parseSql(dialect,sql){
    var source=normalizeDialect(dialect);
    var trimmed=String(sql||'').trim();
    var ast=null;
    if(/^UPDATE\b/i.test(trimmed))ast=parseAdvanced(source,sql,'UpdateStatement','FROM');
    else if(/^DELETE\b/i.test(trimmed))ast=parseAdvanced(source,sql,'DeleteStatement','USING');
    if(!ast)return baseApi.parseSql(source,sql);
    validate(ast,source);
    return deepFreeze(ast);
  }
  function validateRelation(relation,label){
    if(!relation||relation.type!=='TableReference'||!relation.name||!Array.isArray(relation.name.parts)||!relation.name.parts.length)throw new TypeError(label+' must be a table reference');
    if(relation.alias&&(!Array.isArray(relation.alias.parts)||relation.alias.parts.length!==1))throw new TypeError(label+' alias must be a simple identifier');
  }
  function validate(ast,source){
    if(!isAdvanced(ast))throw new TypeError('NuBloxSQL dml-v3 AST requires UPDATE ... FROM or DELETE ... USING');
    baseApi.analyzeAst(cloneWithoutAdvanced(ast));
    if(ast.type==='UpdateStatement'){
      validateRelation(ast.from,'UPDATE FROM relation');
      if(source==='mysql')throw new SyntaxError('PostgreSQL/SQLite UPDATE ... FROM is not valid MySQL source syntax; MySQL multi-table UPDATE is a distinct semantic family');
    }else{
      validateRelation(ast.using,'DELETE USING relation');
      if(source&&source!=='postgresql')throw new SyntaxError('DELETE ... USING in dml-v3 is PostgreSQL source syntax');
    }
    return ast;
  }
  function analyzeAst(ast){
    if(!isAdvanced(ast))return baseApi.analyzeAst(ast);
    validate(ast,null);
    var base=baseApi.analyzeAst(cloneWithoutAdvanced(ast));
    var set=Object.create(null);
    base.capabilities.forEach(function(path){set[path]=true;});
    set[ast.type==='UpdateStatement'?'syntax.updateFrom':'syntax.deleteUsing']=true;
    return deepFreeze({statementType:ast.type,scope:'dml-v3',capabilities:Object.keys(set).sort()});
  }
  function validateTarget(target,ast){
    if(ast.type==='UpdateStatement'){
      if(target==='mysql')throw new RangeError('MySQL multi-table UPDATE is not losslessly identical to PostgreSQL/SQLite UPDATE ... FROM');
    }else if(target!=='postgresql'){
      throw new RangeError('DELETE ... USING is only qualified for PostgreSQL in dml-v3');
    }
  }
  function compileAst(dialect,ast){
    if(!isAdvanced(ast))return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    validate(ast,null);validateTarget(target,ast);
    var compiled=baseApi.compileAst(target,cloneWithoutAdvanced(ast));
    var clause=ast.type==='UpdateStatement'?' FROM '+relationSql(target,ast.from):' USING '+relationSql(target,ast.using);
    return deepFreeze({dialect:target,sql:insertBeforeTail(compiled.sql,clause),targetToSource:compiled.targetToSource.slice()});
  }
  function transpileSql(from,to,sql,options){
    options=options||{};
    var source=normalizeDialect(from),target=normalizeDialect(to);
    var ast=parseSql(source,sql);
    if(!isAdvanced(ast))return baseApi.transpileSql(source,target,sql,options);
    validate(ast,source);
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true){
      var blocked=plan.decisions.filter(function(entry){return entry.action==='reject';}).map(function(entry){return entry.path;});
      throw new RangeError('DML dml-v3 transpilation is blocked by unsupported target capabilities: '+blocked.join(', '));
    }
    if(plan.requiresQualification&&options.allowUnqualified!==true){
      var unresolved=plan.decisions.filter(function(entry){return entry.action==='qualify';}).map(function(entry){return entry.path;});
      throw new RangeError('DML dml-v3 transpilation requires runtime qualification for: '+unresolved.join(', '));
    }
    if(plan.decisions.some(function(entry){return entry.action==='emulate'||entry.action==='rewrite';})){
      throw new RangeError('DML dml-v3 transpilation requires an explicit semantic transformation');
    }
    validateTarget(target,ast);
    var compiled=compileAst(target,ast);
    var lossless=plan.decisions.every(function(entry){return entry.lossless!==false&&entry.action!=='emulate';});
    return deepFreeze({from:source,to:target,scope:'dml-v3',ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:compiled.targetToSource,lossless:lossless,certified:plan.safeToProceed&&lossless});
  }
  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}
exports.create=create;
exports.isAdvancedDmlAst=isAdvanced;

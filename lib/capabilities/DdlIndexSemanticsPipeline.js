'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var PG_METHODS = Object.freeze({ btree:true, hash:true, gist:true, spgist:true, gin:true, brin:true });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function upper(value) { return String(value === undefined || value === null ? '' : value).toUpperCase(); }
function isWord(token, value) {
  return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value;
}
function isIdentifier(node) { return !!(node && node.type === 'Identifier' && Array.isArray(node.parts) && node.parts.length); }
function isAdvanced(ast) {
  return !!(ast && ast.type === 'CreateIndexStatement' && (
    (Array.isArray(ast.keys) && ast.keys.some(function (key) { return key.type === 'IndexExpressionKey'; })) ||
    ast.method || (Array.isArray(ast.include) && ast.include.length)
  ));
}
function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) { value.forEach(function (entry) { walk(entry, visitor); }); return; }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}
function fakeSelect(expression) {
  return { type:'SelectStatement', with:null, distinct:false, columns:[expression], from:null, joins:[], where:null, groupBy:[], having:null, windows:[], orderBy:[], limit:null, offset:null };
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function fail(message, token, sql) {
    var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
    error.position = token ? token.start : sql.length;
    throw error;
  }

  function parseAdvanced(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect);
    var p = 0;
    function peek(offset) { return tokens[p + (offset || 0)]; }
    function take() { return tokens[p++]; }
    function word(value, offset) { return isWord(peek(offset), value); }
    function punctuation(value, offset) { var token=peek(offset); return !!token && token.type === 'punctuation' && token.value === value; }
    function expectWord(value) { if (!word(value)) fail('Expected ' + value, peek(), sql); return take(); }
    function expectPunctuation(value) { if (!punctuation(value)) fail('Expected ' + value, peek(), sql); return take(); }
    function identifier(simple) {
      var token=peek();
      if (!token || token.type !== 'identifier') fail('Expected identifier', token, sql);
      var parts=[take().value];
      while (punctuation('.') && peek(1) && peek(1).type === 'identifier') { take(); parts.push(take().value); }
      if (simple && parts.length !== 1) fail('Expected unqualified identifier', token, sql);
      return {type:'Identifier',parts:parts};
    }
    function endIndex() {
      var end=tokens.length-1;
      if (end>0 && tokens[end-1].type==='punctuation' && tokens[end-1].value===';') end-=1;
      return end;
    }
    function matchingParen(open, end) {
      var depth=0;
      for(var i=open;i<end;i+=1){
        var token=tokens[i];
        if(token.type==='punctuation'&&token.value==='(') depth+=1;
        else if(token.type==='punctuation'&&token.value===')'){depth-=1;if(depth===0)return i;}
      }
      fail('Unclosed index parenthesis',tokens[open],sql);
    }
    function fragment(start,end) {
      if(end<=start) fail('Expected index expression',tokens[start]||peek(),sql);
      return sql.slice(tokens[start].start,tokens[end-1].end);
    }
    function expression(start,end) {
      var raw=fragment(start,end);
      var parsed=baseApi.parseSql(dialect,'SELECT '+raw);
      if(!parsed||parsed.type!=='SelectStatement'||parsed.columns.length!==1||parsed.from) fail('Invalid index expression',tokens[start],sql);
      var value=parsed.columns[0];
      if(value.type==='AliasedExpression') fail('Index expression cannot have an alias',tokens[start],sql);
      walk(value,function(node){
        if(node.type==='Parameter') fail('Index expressions cannot contain bind parameters',tokens[start],sql);
        if(node.type==='WindowExpression'||node.type==='SubqueryExpression'||node.type==='Wildcard') fail('Unsupported index expression',tokens[start],sql);
      });
      return value;
    }
    function expressionKey(start,end) {
      var parseStart=start, parseEnd=end, wrapped=false;
      if(tokens[start] && tokens[start].type==='punctuation' && tokens[start].value==='(') {
        var close=matchingParen(start,end);
        if(close===end-1){parseStart=start+1;parseEnd=end-1;wrapped=true;}
      }
      if(dialect==='mysql' && !wrapped) fail('MySQL functional index key parts require double-parenthesized expressions',tokens[start],sql);
      return {type:'IndexExpressionKey',expression:expression(parseStart,parseEnd),family:dialect==='mysql'?'functional':'expression'};
    }
    function keyList(open,end) {
      var close=matchingParen(open,end);
      var result=[]; var start=open+1; var depth=0;
      for(var i=start;i<=close;i+=1){
        var token=tokens[i];
        var atEnd=i===close;
        if(!atEnd && token.type==='punctuation' && token.value==='(') depth+=1;
        else if(!atEnd && token.type==='punctuation' && token.value===')') depth-=1;
        if(atEnd || (depth===0 && token.type==='punctuation' && token.value===',')) {
          if(i<=start) fail('Empty index key part',token,sql);
          if(i===start+1 && tokens[start].type==='identifier') result.push({type:'IndexColumnKey',column:{type:'Identifier',parts:[tokens[start].value]}});
          else result.push(expressionKey(start,i));
          start=i+1;
        }
      }
      return {keys:result,close:close};
    }
    function identifierList() {
      var result=[]; expectPunctuation('(');
      do { result.push(identifier(true)); if(!punctuation(',')) break; take(); } while(true);
      expectPunctuation(')'); return result;
    }

    if(!word('CREATE')) return null;
    take();
    var unique=false;
    if(word('UNIQUE')) { unique=true; take(); }
    if(!word('INDEX')) return null;
    take();
    if(word('CONCURRENTLY')) return null;
    var ifNotExists=false;
    if(word('IF')) { take(); expectWord('NOT'); expectWord('EXISTS'); ifNotExists=true; }
    var name=identifier(false);
    expectWord('ON');
    var table=identifier(false);
    var method=null;
    if(word('USING')) { take(); method=identifier(true).parts[0].toLowerCase(); }
    if(!punctuation('(')) return null;
    var open=p; var parsedKeys=keyList(open,endIndex()); p=parsedKeys.close+1;
    var include=[];
    if(word('INCLUDE')) { take(); include=identifierList(); }
    var where=null;
    if(word('WHERE')) { take(); var end=endIndex(); where=expression(p,end); p=end; }
    var end=endIndex();
    if(p!==end) fail('Unexpected CREATE INDEX SQL',tokens[p],sql);

    var advanced=parsedKeys.keys.some(function(key){return key.type==='IndexExpressionKey';}) || !!method || include.length>0;
    if(!advanced) return null;

    if(dialect!=='postgresql' && (method || include.length)) fail('USING/INCLUDE index semantics are PostgreSQL-only in ddl-v8',tokens[0],sql);
    if(dialect==='mysql' && ifNotExists) fail('CREATE INDEX IF NOT EXISTS is not valid MySQL source syntax',tokens[0],sql);
    if(method && !PG_METHODS[method]) fail('ddl-v8 only qualifies built-in PostgreSQL index access methods',tokens[0],sql);

    var columns=parsedKeys.keys.filter(function(key){return key.type==='IndexColumnKey';}).map(function(key){return key.column;});
    return {
      type:'CreateIndexStatement', name:name, table:table, columns:columns, keys:parsedKeys.keys,
      unique:unique, where:where, ifNotExists:ifNotExists, method:method, include:include
    };
  }

  function validate(ast) {
    if(!isAdvanced(ast)) throw new TypeError('NuBloxSQL ddl-v8 AST requires advanced CREATE INDEX semantics');
    if(!isIdentifier(ast.name)||!isIdentifier(ast.table)) throw new TypeError('ddl-v8 index/table identity must be structured identifiers');
    if(!Array.isArray(ast.keys)||ast.keys.length===0) throw new RangeError('ddl-v8 requires at least one index key');
    ast.keys.forEach(function(key){
      if(key.type==='IndexColumnKey') { if(!isIdentifier(key.column)||key.column.parts.length!==1) throw new TypeError('Index column key must be an unqualified identifier'); }
      else if(key.type==='IndexExpressionKey') {
        if(!key.expression||typeof key.expression!=='object') throw new TypeError('Index expression key requires an expression AST');
        if(key.family!=='expression'&&key.family!=='functional') throw new RangeError('Invalid index expression family');
      } else throw new RangeError('Unsupported ddl-v8 index key type');
    });
    (ast.include||[]).forEach(function(column){if(!isIdentifier(column)||column.parts.length!==1)throw new TypeError('INCLUDE columns must be unqualified identifiers');});
    if(ast.method && !PG_METHODS[String(ast.method).toLowerCase()]) throw new RangeError('Unsupported ddl-v8 PostgreSQL access method');
    return ast;
  }

  function expressionCapabilities(paths, expression) {
    var analysis=baseApi.analyzeAst(fakeSelect(expression));
    (analysis.capabilities||[]).forEach(function(path){if(paths.indexOf(path)===-1)paths.push(path);});
  }

  function analyzeAst(ast) {
    if(!isAdvanced(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var capabilities=['statements.createIndex'];
    if(ast.unique) capabilities.push('schema.uniqueIndex');
    ast.keys.forEach(function(key){
      if(key.type==='IndexExpressionKey') {
        var path=key.family==='functional'?'schema.functionalIndex':'schema.expressionIndex';
        if(capabilities.indexOf(path)===-1) capabilities.push(path);
        expressionCapabilities(capabilities,key.expression);
      }
    });
    if(ast.include&&ast.include.length) capabilities.push('schema.coveringIndex');
    if(ast.method) capabilities.push('schema.indexAccessMethod');
    if(ast.where) { capabilities.push('schema.partialIndex'); expressionCapabilities(capabilities,ast.where); }
    if(ast.ifNotExists) capabilities.push('syntax.existence.createIndexIfNotExists');
    capabilities.sort();
    return deepFreeze({statementType:ast.type,scope:'ddl-v8',capabilities:capabilities});
  }

  function expressionSql(dialect, expression) {
    var compiled=baseApi.compileAst(dialect,fakeSelect(expression));
    if(compiled.targetToSource&&compiled.targetToSource.length) throw new RangeError('Index expressions cannot contain bind parameters');
    if(compiled.sql.slice(0,7)!=='SELECT ') throw new Error('Unexpected index expression compiler output');
    return compiled.sql.slice(7);
  }
  function quote(dialect,node){return node.parts.map(function(part){return Compiler.quoteIdentifier(dialect,part);}).join('.');}

  function targetGuard(dialect,ast,source) {
    var expressions=ast.keys.filter(function(key){return key.type==='IndexExpressionKey';});
    if(ast.method||ast.include.length) {
      if(dialect!=='postgresql') throw new RangeError('ddl-v8 USING/INCLUDE semantics are PostgreSQL-only');
    }
    if(ast.ifNotExists&&dialect==='mysql') throw new RangeError('MySQL does not support CREATE INDEX IF NOT EXISTS in ddl-v8');
    if(expressions.length && source && source!==dialect) {
      throw new RangeError('Cross-dialect expression/functional index translation requires an explicit semantic decision in ddl-v8');
    }
    expressions.forEach(function(key){
      if(dialect==='mysql'&&key.family!=='functional') throw new RangeError('MySQL functional index semantics are distinct from PostgreSQL/SQLite expression-index semantics');
      if(dialect!=='mysql'&&key.family==='functional') throw new RangeError('MySQL functional key parts are not treated as losslessly identical to target expression indexes');
    });
  }

  function compileAst(dialect,ast) {
    if(!isAdvanced(ast)) return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect); validate(ast); targetGuard(target,ast,null);
    var sql='CREATE '+(ast.unique?'UNIQUE ':'')+'INDEX '+(ast.ifNotExists?'IF NOT EXISTS ':'')+quote(target,ast.name)+' ON '+quote(target,ast.table);
    if(ast.method) sql+=' USING '+ast.method;
    sql+=' ('+ast.keys.map(function(key){
      if(key.type==='IndexColumnKey') return quote(target,key.column);
      return '('+expressionSql(target,key.expression)+')';
    }).join(', ')+')';
    if(ast.include&&ast.include.length) sql+=' INCLUDE ('+ast.include.map(function(column){return quote(target,column);}).join(', ')+')';
    if(ast.where) sql+=' WHERE '+expressionSql(target,ast.where);
    return deepFreeze({dialect:target,sql:sql,targetToSource:[]});
  }

  function parseSql(dialect,sql) {
    var source=normalizeDialect(dialect);
    var ast=parseAdvanced(sql,source);
    if(!ast) return baseApi.parseSql(source,sql);
    validate(ast); return deepFreeze(ast);
  }

  function transpileSql(from,to,sql,options) {
    options=options||{};
    var source=normalizeDialect(from), target=normalizeDialect(to);
    var ast=parseSql(source,sql);
    if(!isAdvanced(ast)) return baseApi.transpileSql(source,target,sql,options);
    targetGuard(target,ast,source);
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true) {
      var blocked=plan.decisions.filter(function(entry){return entry.action==='reject';}).map(function(entry){return entry.path;});
      throw new RangeError('DDL ddl-v8 transpilation is blocked by unsupported target capabilities: '+blocked.join(', '));
    }
    if(plan.requiresQualification&&options.allowUnqualified!==true) {
      var unresolved=plan.decisions.filter(function(entry){return entry.action==='qualify';}).map(function(entry){return entry.path;});
      throw new RangeError('DDL ddl-v8 transpilation requires runtime qualification for: '+unresolved.join(', '));
    }
    if(plan.decisions.some(function(entry){return entry.action==='emulate'||(entry.action==='rewrite'&&!(entry.level==='exact'&&entry.lossless===true));})) {
      throw new RangeError('DDL ddl-v8 transpilation requires an explicit semantic transformation');
    }
    var compiled=compileAst(target,ast);
    var lossless=plan.decisions.every(function(entry){return entry.lossless!==false&&entry.action!=='emulate';});
    return deepFreeze({from:source,to:target,scope:'ddl-v8',ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:[],lossless:lossless,certified:plan.safeToProceed&&lossless});
  }

  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}

exports.create=create;
exports.isAdvancedAst=isAdvanced;
exports.PG_METHODS=PG_METHODS;

'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function upper(value) { return String(value === undefined || value === null ? '' : value).toUpperCase(); }
function isWord(token, value) {
  return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value;
}
function isAst(ast) { return !!(ast && ast.type === 'CreateTableAsStatement'); }
function isQueryAst(ast) { return !!(ast && (ast.type === 'SelectStatement' || ast.type === 'SetOperationStatement')); }
function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) { value.forEach(function (entry) { walk(entry, visitor); }); return; }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function fail(message, token, sql) {
    var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
    error.position = token ? token.start : sql.length;
    throw error;
  }
  function parseCtas(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect);
    var p = 0;
    function peek(offset) { return tokens[p + (offset || 0)]; }
    function take() { return tokens[p++]; }
    function word(value, offset) { return isWord(peek(offset), value); }
    function expect(value) { if (!word(value)) fail('Expected ' + value, peek(), sql); return take(); }
    function punctuation(value) { var token=peek(); return !!token && token.type === 'punctuation' && token.value === value; }
    function identifier() {
      var token=peek();
      if (!token || token.type !== 'identifier') fail('Expected identifier', token, sql);
      var parts=[take().value];
      while (punctuation('.') && peek(1) && peek(1).type === 'identifier') { take(); parts.push(take().value); }
      return {type:'Identifier',parts:parts};
    }
    function endIndex() {
      var end=tokens.length-1;
      if (end>0 && tokens[end-1].type==='punctuation' && tokens[end-1].value===';') end-=1;
      return end;
    }

    if (!word('CREATE') || !word('TABLE',1)) return null;
    take(); take();
    var ifNotExists=false;
    if (word('IF')) { take(); expect('NOT'); expect('EXISTS'); ifNotExists=true; }
    var name=identifier();
    if (!word('AS')) return null;
    take();
    var end=endIndex();
    if (p>=end) fail('CREATE TABLE AS requires a query',peek(),sql);
    var queryText=sql.slice(tokens[p].start,tokens[end-1].end);
    var query=baseApi.parseSql(dialect,queryText);
    if (!isQueryAst(query)) fail('CREATE TABLE AS requires a SELECT/compound query',tokens[p],sql);
    walk(query,function(node){ if(node.type==='Parameter') fail('CREATE TABLE AS query cannot contain bind parameters in ddl-v10',tokens[p],sql); });
    return {type:'CreateTableAsStatement',name:name,query:query,ifNotExists:ifNotExists};
  }

  function validateIdentifier(node) {
    if (!node || node.type!=='Identifier' || !Array.isArray(node.parts) || node.parts.length===0) throw new TypeError('CREATE TABLE AS name must be an Identifier');
  }
  function validate(ast) {
    if (!isAst(ast)) throw new TypeError('NuBloxSQL ddl-v10 AST requires CreateTableAsStatement');
    validateIdentifier(ast.name);
    if (typeof ast.ifNotExists!=='boolean') throw new TypeError('CREATE TABLE AS ifNotExists must be boolean');
    if (!isQueryAst(ast.query)) throw new TypeError('CREATE TABLE AS query must be a query AST');
    baseApi.analyzeAst(ast.query);
    walk(ast.query,function(node){ if(node.type==='Parameter') throw new RangeError('CREATE TABLE AS query cannot contain bind parameters in ddl-v10'); });
    return ast;
  }
  function quote(dialect,node){return node.parts.map(function(part){return Compiler.quoteIdentifier(dialect,part);}).join('.');}

  function parseSql(dialect,sql) {
    var source=normalizeDialect(dialect);
    var ast=parseCtas(sql,source);
    if(!ast) return baseApi.parseSql(source,sql);
    validate(ast);
    return deepFreeze(ast);
  }

  function analyzeAst(ast) {
    if(!isAst(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var capabilities=['statements.createTableAs'];
    if(ast.ifNotExists) capabilities.push('syntax.existence.createTableIfNotExists');
    var queryAnalysis=baseApi.analyzeAst(ast.query);
    (queryAnalysis.capabilities||[]).forEach(function(path){if(capabilities.indexOf(path)===-1)capabilities.push(path);});
    capabilities.sort();
    return deepFreeze({statementType:ast.type,scope:'ddl-v10',capabilities:capabilities});
  }

  function compileAst(dialect,ast) {
    if(!isAst(ast)) return baseApi.compileAst(dialect,ast);
    var target=normalizeDialect(dialect);
    validate(ast);
    var query=baseApi.compileAst(target,ast.query);
    if(query.targetToSource&&query.targetToSource.length) throw new RangeError('CREATE TABLE AS query cannot contain bind parameters in ddl-v10');
    var sql='CREATE TABLE '+(ast.ifNotExists?'IF NOT EXISTS ':'')+quote(target,ast.name)+' AS '+query.sql;
    return deepFreeze({dialect:target,sql:sql,targetToSource:[]});
  }

  function transpileSql(from,to,sql,options) {
    options=options||{};
    var source=normalizeDialect(from), target=normalizeDialect(to);
    var ast=parseSql(source,sql);
    if(!isAst(ast)) return baseApi.transpileSql(source,target,sql,options);
    var analysis=analyzeAst(ast);
    var plan=rewriteApi.plan(source,target,analysis.capabilities,options);
    if(plan.blocked&&options.allowBlocked!==true) {
      var blocked=plan.decisions.filter(function(entry){return entry.action==='reject';}).map(function(entry){return entry.path;});
      throw new RangeError('DDL ddl-v10 transpilation is blocked by unsupported target capabilities: '+blocked.join(', '));
    }
    if(plan.requiresQualification&&options.allowUnqualified!==true) {
      var unresolved=plan.decisions.filter(function(entry){return entry.action==='qualify';}).map(function(entry){return entry.path;});
      throw new RangeError('DDL ddl-v10 transpilation requires runtime qualification for: '+unresolved.join(', '));
    }
    if(plan.decisions.some(function(entry){return entry.action==='emulate'||(entry.action==='rewrite'&&!(entry.level==='exact'&&entry.lossless===true));})) {
      throw new RangeError('DDL ddl-v10 transpilation requires an explicit semantic transformation');
    }
    var compiled=compileAst(target,ast);
    var lossless=plan.decisions.every(function(entry){return entry.lossless!==false&&entry.action!=='emulate';});
    return deepFreeze({from:source,to:target,scope:'ddl-v10',ast:ast,capabilities:analysis.capabilities,plan:plan,sql:compiled.sql,targetToSource:[],lossless:lossless,certified:plan.safeToProceed&&lossless});
  }

  return Object.freeze({parseSql:parseSql,analyzeAst:analyzeAst,compileAst:compileAst,transpileSql:transpileSql});
}

exports.create=create;
exports.isAst=isAst;

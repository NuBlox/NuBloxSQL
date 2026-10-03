'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var NEW_DROP_CAPABILITY = Object.freeze({
  DropIndexStatement: 'statements.dropIndex',
  DropSchemaStatement: 'statements.dropSchema',
  DropSequenceStatement: 'statements.dropSequence'
});
var CREATE_EXISTENCE = Object.freeze({
  CreateTableStatement: 'syntax.existence.createTableIfNotExists',
  CreateIndexStatement: 'syntax.existence.createIndexIfNotExists',
  CreateSchemaStatement: 'syntax.existence.createSchemaIfNotExists',
  CreateSequenceStatement: 'syntax.existence.createSequenceIfNotExists'
});
var DROP_EXISTENCE = Object.freeze({
  DropTableStatement: 'syntax.existence.dropTableIfExists',
  DropViewStatement: 'syntax.existence.dropViewIfExists',
  DropIndexStatement: 'syntax.existence.dropIndexIfExists',
  DropSchemaStatement: 'syntax.existence.dropSchemaIfExists',
  DropSequenceStatement: 'syntax.existence.dropSequenceIfExists'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function upper(value) { return String(value || '').toUpperCase(); }
function isWord(token, value) { return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value; }
function isNewDrop(ast) { return !!(ast && NEW_DROP_CAPABILITY[ast.type]); }
function hasExistence(ast) { return !!(ast && (ast.ifExists === true || ast.ifNotExists === true)); }
function isAst(ast) { return isNewDrop(ast) || hasExistence(ast); }
function cloneWithoutExistence(ast) {
  var copy = {};
  Object.keys(ast).forEach(function (key) { if (key !== 'ifExists' && key !== 'ifNotExists') copy[key] = ast[key]; });
  return copy;
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function fail(message, token, sql) {
    var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
    error.position = token ? token.start : sql.length;
    throw error;
  }
  function identifierParser(tokens, state, sql, simple) {
    var token = tokens[state.p];
    if (!token || token.type !== 'identifier') fail('Expected identifier', token, sql);
    var parts = [token.value]; state.p += 1;
    while (tokens[state.p] && tokens[state.p].type === 'punctuation' && tokens[state.p].value === '.' && tokens[state.p + 1] && tokens[state.p + 1].type === 'identifier') {
      state.p += 1; parts.push(tokens[state.p].value); state.p += 1;
    }
    if (simple && parts.length !== 1) fail('Expected unqualified identifier', token, sql);
    return { type: 'Identifier', parts: parts };
  }
  function parseNewDrop(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect); var state = { p: 0 };
    function peek(offset) { return tokens[state.p + (offset || 0)]; }
    function take() { return tokens[state.p++]; }
    function word(value, offset) { return isWord(peek(offset), value); }
    function expect(value) { if (!word(value)) fail('Expected ' + value, peek(), sql); return take(); }
    if (!word('DROP') || !(word('INDEX', 1) || word('SCHEMA', 1) || word('SEQUENCE', 1))) return null;
    expect('DROP');
    var kind = upper(take().value);
    var ifExists = false;
    if (word('IF')) { take(); expect('EXISTS'); ifExists = true; }
    var name = identifierParser(tokens, state, sql, false);
    var table = null;
    if (kind === 'INDEX' && word('ON')) { take(); table = identifierParser(tokens, state, sql, false); }
    if (peek() && peek().type === 'punctuation' && peek().value === ';') take();
    if (!peek() || peek().type !== 'eof') fail('Unexpected DROP ' + kind + ' SQL', peek(), sql);
    var type = kind === 'INDEX' ? 'DropIndexStatement' : kind === 'SCHEMA' ? 'DropSchemaStatement' : 'DropSequenceStatement';
    return { type: type, name: name, table: table, ifExists: ifExists };
  }

  function parseExistingModifier(sql, dialect) {
    var createMatch = /^\s*CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|SCHEMA|SEQUENCE)\s+IF\s+NOT\s+EXISTS\s+/i.exec(sql);
    if (createMatch) {
      var kind = upper(createMatch[1]);
      if (dialect === 'mysql' && kind === 'INDEX') throw new SyntaxError('CREATE INDEX IF NOT EXISTS is not valid MySQL source syntax');
      if (dialect === 'sqlite' && (kind === 'SCHEMA' || kind === 'SEQUENCE')) throw new SyntaxError('CREATE ' + kind + ' IF NOT EXISTS is not valid SQLite source syntax');
      if (dialect === 'mysql' && kind === 'SEQUENCE') throw new SyntaxError('CREATE SEQUENCE IF NOT EXISTS is not valid MySQL source syntax');
      var strippedCreate = sql.replace(/(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SCHEMA|SEQUENCE)\s+)IF\s+NOT\s+EXISTS\s+/i, '$1');
      var created = baseApi.parseSql(dialect, strippedCreate);
      if (!CREATE_EXISTENCE[created.type]) throw new SyntaxError('IF NOT EXISTS is outside the released ddl-v4 create scope');
      var createCopy = {};
      Object.keys(created).forEach(function (key) { createCopy[key] = created[key]; });
      createCopy.ifNotExists = true;
      return createCopy;
    }

    var dropMatch = /^\s*DROP\s+(TABLE|VIEW)\s+IF\s+EXISTS\s+/i.exec(sql);
    if (dropMatch) {
      var strippedDrop = sql.replace(/(DROP\s+(?:TABLE|VIEW)\s+)IF\s+EXISTS\s+/i, '$1');
      var dropped = baseApi.parseSql(dialect, strippedDrop);
      if (!DROP_EXISTENCE[dropped.type]) throw new SyntaxError('IF EXISTS is outside the released ddl-v4 drop scope');
      var dropCopy = {};
      Object.keys(dropped).forEach(function (key) { dropCopy[key] = dropped[key]; });
      dropCopy.ifExists = true;
      return dropCopy;
    }
    return null;
  }

  function validateIdentifier(node, label) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
  }
  function validateSourceDialect(dialect, ast) {
    if (ast.type === 'DropIndexStatement') {
      if (dialect === 'mysql' && !ast.table) throw new SyntaxError('MySQL DROP INDEX requires ON table');
      if (dialect !== 'mysql' && ast.table) throw new SyntaxError('PostgreSQL/SQLite DROP INDEX does not use ON table in ddl-v4');
      if (dialect === 'mysql' && ast.ifExists) throw new SyntaxError('DROP INDEX IF EXISTS is not valid MySQL source syntax');
    }
    if (ast.type === 'DropSchemaStatement' && dialect === 'sqlite') throw new SyntaxError('DROP SCHEMA is not valid SQLite source syntax');
    if (ast.type === 'DropSequenceStatement' && dialect !== 'postgresql') throw new SyntaxError('DROP SEQUENCE is not valid source syntax for ' + dialect);
  }
  function validateTargetDialect(dialect, ast, source) {
    if (ast.type === 'DropIndexStatement') {
      if (dialect === 'mysql' && !ast.table) throw new RangeError('MySQL DROP INDEX requires table identity; ddl-v4 will not infer it');
      if (dialect !== 'mysql' && ast.table) throw new RangeError('MySQL table-scoped DROP INDEX cannot be treated as losslessly identical to target index identity');
      if (dialect === 'mysql' && ast.ifExists) throw new RangeError('MySQL does not support DROP INDEX IF EXISTS in ddl-v4');
      if (source && source !== dialect && (source === 'mysql' || dialect === 'mysql')) throw new RangeError('Cross-family DROP INDEX requires an explicit index-identity transformation');
    }
    if (ast.type === 'DropSchemaStatement') {
      if (dialect === 'sqlite') throw new RangeError('SQLite does not support DROP SCHEMA');
      if (source && source !== dialect && (source === 'mysql' || dialect === 'mysql')) throw new RangeError('PostgreSQL schema namespaces and MySQL database/schema objects are not losslessly equivalent');
    }
    if (ast.type === 'DropSequenceStatement' && dialect !== 'postgresql') throw new RangeError('Target dialect does not support DROP SEQUENCE');
    if (ast.ifNotExists) {
      if (ast.type === 'CreateIndexStatement' && dialect === 'mysql') throw new RangeError('MySQL does not support CREATE INDEX IF NOT EXISTS');
      if (ast.type === 'CreateSchemaStatement' && dialect === 'sqlite') throw new RangeError('SQLite does not support CREATE SCHEMA IF NOT EXISTS');
      if (ast.type === 'CreateSequenceStatement' && dialect !== 'postgresql') throw new RangeError('Target dialect does not support CREATE SEQUENCE IF NOT EXISTS');
    }
  }
  function validate(ast) {
    if (isNewDrop(ast)) {
      validateIdentifier(ast.name, 'DROP object name');
      if (ast.table) validateIdentifier(ast.table, 'DROP INDEX table');
      if (typeof ast.ifExists !== 'boolean') throw new TypeError('DROP object ifExists must be boolean');
      return ast;
    }
    if (hasExistence(ast)) {
      if (ast.ifExists && !DROP_EXISTENCE[ast.type]) throw new RangeError('IF EXISTS is not supported for ' + ast.type + ' in ddl-v4');
      if (ast.ifNotExists && !CREATE_EXISTENCE[ast.type]) throw new RangeError('IF NOT EXISTS is not supported for ' + ast.type + ' in ddl-v4');
      baseApi.analyzeAst(cloneWithoutExistence(ast));
      return ast;
    }
    throw new TypeError('NuBloxSQL ddl-v4 AST requires an object lifecycle statement or existence modifier');
  }

  function quote(dialect, node) { return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.'); }
  function injectCreateModifier(sql) {
    return sql.replace(/^(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SCHEMA|SEQUENCE)\s+)/i, '$1IF NOT EXISTS ');
  }
  function injectDropModifier(sql) { return sql.replace(/^(DROP\s+(?:TABLE|VIEW)\s+)/i, '$1IF EXISTS '); }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var ast = parseNewDrop(sql, source) || parseExistingModifier(sql, source);
    if (!ast) return baseApi.parseSql(source, sql);
    validate(ast); validateSourceDialect(source, ast);
    return deepFreeze(ast);
  }
  function analyzeAst(ast) {
    if (!isAst(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var capabilities = [];
    if (isNewDrop(ast)) capabilities.push(NEW_DROP_CAPABILITY[ast.type]);
    else baseApi.analyzeAst(cloneWithoutExistence(ast)).capabilities.forEach(function (path) { capabilities.push(path); });
    var existence = ast.ifExists ? DROP_EXISTENCE[ast.type] : ast.ifNotExists ? CREATE_EXISTENCE[ast.type] : null;
    if (existence && capabilities.indexOf(existence) === -1) capabilities.push(existence);
    capabilities.sort();
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v4', capabilities: capabilities });
  }
  function compileAst(dialect, ast) {
    if (!isAst(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect); validate(ast); validateTargetDialect(target, ast, null);
    if (!isNewDrop(ast)) {
      var base = baseApi.compileAst(target, cloneWithoutExistence(ast));
      var sql = ast.ifNotExists ? injectCreateModifier(base.sql) : injectDropModifier(base.sql);
      return deepFreeze({ dialect: target, sql: sql, targetToSource: [] });
    }
    var sql;
    if (ast.type === 'DropIndexStatement') {
      sql = 'DROP INDEX ' + (ast.ifExists ? 'IF EXISTS ' : '') + quote(target, ast.name);
      if (target === 'mysql') sql += ' ON ' + quote(target, ast.table);
    } else if (ast.type === 'DropSchemaStatement') sql = 'DROP SCHEMA ' + (ast.ifExists ? 'IF EXISTS ' : '') + quote(target, ast.name);
    else sql = 'DROP SEQUENCE ' + (ast.ifExists ? 'IF EXISTS ' : '') + quote(target, ast.name);
    return deepFreeze({ dialect: target, sql: sql, targetToSource: [] });
  }
  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from); var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    if (!isAst(ast)) return baseApi.transpileSql(source, target, sql, options);
    var analysis = analyzeAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v4 transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v4 transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate' || entry.action === 'rewrite'; })) {
      throw new RangeError('DDL ddl-v4 transpilation requires an explicit semantic transformation');
    }
    validateTargetDialect(target, ast, source);
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: 'ddl-v4', ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: [], lossless: lossless, certified: plan.safeToProceed && lossless });
  }

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isAst = isAst;
exports.NEW_DROP_CAPABILITY = NEW_DROP_CAPABILITY;
exports.CREATE_EXISTENCE = CREATE_EXISTENCE;
exports.DROP_EXISTENCE = DROP_EXISTENCE;

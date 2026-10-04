'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var OPTION_CAPABILITIES = Object.freeze({
  start: 'schema.sequenceOptions.start',
  increment: 'schema.sequenceOptions.increment',
  minValue: 'schema.sequenceOptions.minValue',
  maxValue: 'schema.sequenceOptions.maxValue',
  cache: 'schema.sequenceOptions.cache',
  cycle: 'schema.sequenceOptions.cycle'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function upper(value) { return String(value || '').toUpperCase(); }
function isWord(token, value) { return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value; }
function isSignedIntegerToken(token) { return !!token && (token.type === 'number' || (token.type === 'operator' && (token.value === '+' || token.value === '-'))); }
function isAdvanced(ast) {
  return !!(ast && ((ast.type === 'CreateSequenceStatement' && ast.options) ||
    (ast.type === 'CreateTableStatement' && ast.columns.some(function (column) {
      return !!(column.autoIncrement || (column.identity && column.identity.options));
    }))));
}
function cloneWithoutAdvanced(ast) {
  var copy = {};
  Object.keys(ast).forEach(function (key) { if (key !== 'options') copy[key] = ast[key]; });
  if (ast.type === 'CreateTableStatement') {
    copy.columns = ast.columns.map(function (column) {
      var c = {};
      Object.keys(column).forEach(function (key) {
        if (key === 'autoIncrement') return;
        if (key === 'identity' && column.identity && column.identity.options) c.identity = { mode: column.identity.mode };
        else c[key] = column[key];
      });
      return c;
    });
  }
  return copy;
}
function parseInteger(text, label, positive) {
  if (!/^[+-]?\d+$/.test(text)) throw new SyntaxError(label + ' requires an integer');
  var value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(label + ' is outside the safe integer range');
  if (positive && value < 1) throw new RangeError(label + ' must be at least 1');
  return value;
}
function parseOptions(text) {
  var tokens = Tokenizer.tokenize(text, 'postgresql'); var p = 0; var result = {};
  function peek(offset) { return tokens[p + (offset || 0)]; }
  function word(value, offset) { return isWord(peek(offset), value); }
  function take() { return tokens[p++]; }
  function number(label, positive) {
    var sign = '';
    if (peek() && peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) sign = take().value;
    var token = take();
    if (!token || token.type !== 'number' || !/^\d+$/.test(String(token.value))) throw new SyntaxError(label + ' requires an integer');
    return parseInteger(sign + token.value, label, positive);
  }
  function once(key) { if (Object.prototype.hasOwnProperty.call(result, key)) throw new SyntaxError('Duplicate sequence option ' + key); }
  while (peek() && peek().type !== 'eof') {
    if (word('START')) { take(); if (word('WITH')) take(); once('start'); result.start = number('START', false); continue; }
    if (word('INCREMENT')) { take(); if (word('BY')) take(); once('increment'); result.increment = number('INCREMENT', false); if (result.increment === 0) throw new RangeError('INCREMENT cannot be zero'); continue; }
    if (word('MINVALUE')) { take(); once('minValue'); result.minValue = number('MINVALUE', false); continue; }
    if (word('MAXVALUE')) { take(); once('maxValue'); result.maxValue = number('MAXVALUE', false); continue; }
    if (word('CACHE')) { take(); once('cache'); result.cache = number('CACHE', true); continue; }
    if (word('CYCLE')) { take(); once('cycle'); result.cycle = true; continue; }
    if (word('NO') && word('MINVALUE', 1)) { take(); take(); once('minValue'); result.minValue = null; continue; }
    if (word('NO') && word('MAXVALUE', 1)) { take(); take(); once('maxValue'); result.maxValue = null; continue; }
    if (word('NO') && word('CYCLE', 1)) { take(); take(); once('cycle'); result.cycle = false; continue; }
    throw new SyntaxError('Unsupported sequence option: ' + String(peek().value));
  }
  if (!Object.keys(result).length) throw new SyntaxError('Sequence option list cannot be empty');
  return result;
}
function optionSql(options) {
  var parts = [];
  if (Object.prototype.hasOwnProperty.call(options, 'start')) parts.push('START WITH ' + options.start);
  if (Object.prototype.hasOwnProperty.call(options, 'increment')) parts.push('INCREMENT BY ' + options.increment);
  if (Object.prototype.hasOwnProperty.call(options, 'minValue')) parts.push(options.minValue === null ? 'NO MINVALUE' : 'MINVALUE ' + options.minValue);
  if (Object.prototype.hasOwnProperty.call(options, 'maxValue')) parts.push(options.maxValue === null ? 'NO MAXVALUE' : 'MAXVALUE ' + options.maxValue);
  if (Object.prototype.hasOwnProperty.call(options, 'cache')) parts.push('CACHE ' + options.cache);
  if (Object.prototype.hasOwnProperty.call(options, 'cycle')) parts.push(options.cycle ? 'CYCLE' : 'NO CYCLE');
  return parts.join(' ');
}
function sequencePreprocess(sql, source) {
  if (source !== 'postgresql' || !/^\s*CREATE\s+SEQUENCE\b/i.test(sql)) return null;
  var match = /^\s*(CREATE\s+SEQUENCE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*))*)\s+([\s\S]+?)\s*;?\s*$/i.exec(sql);
  if (!match) return null;
  return { sql: match[1], options: parseOptions(match[2]) };
}
function identityPreprocess(sql, source) {
  if (source !== 'postgresql' || !/GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\s*\(/i.test(sql)) return null;
  var options = [];
  var stripped = sql.replace(/(GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY)\s*\(([^()]*)\)/gi, function (_, clause, body) {
    options.push(parseOptions(body)); return clause;
  });
  return { sql: stripped, options: options };
}
function autoIncrementPreprocess(sql, source) {
  if ((source !== 'mysql' && source !== 'sqlite') || !/\bAUTO_INCREMENT\b|\bAUTOINCREMENT\b/i.test(sql)) return null;
  var keyword = source === 'mysql' ? 'AUTO_INCREMENT' : 'AUTOINCREMENT';
  var regex = source === 'mysql' ? /\bAUTO_INCREMENT\b/ig : /\bAUTOINCREMENT\b/ig;
  var stripped = sql.replace(regex, '');
  var tokens = Tokenizer.tokenize(sql, source); var open = -1; var depth = 0; var close = -1;
  for (var i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === 'punctuation' && tokens[i].value === '(') { if (open < 0) open = i; depth += 1; }
    else if (tokens[i].type === 'punctuation' && tokens[i].value === ')') { depth -= 1; if (open >= 0 && depth === 0) { close = i; break; } }
  }
  if (open < 0 || close < 0) return null;
  var names = []; var start = open + 1; depth = 0;
  function inspectRange(a, b) {
    var found = false; var first = null;
    for (var j = a; j < b; j += 1) {
      if (!first && tokens[j].type === 'identifier') first = tokens[j].value;
      if (isWord(tokens[j], keyword)) found = true;
    }
    if (found) {
      if (!first) throw new SyntaxError(keyword + ' requires a column definition');
      names.push(String(first));
    }
  }
  for (var k = open + 1; k < close; k += 1) {
    if (tokens[k].type === 'punctuation' && tokens[k].value === '(') depth += 1;
    else if (tokens[k].type === 'punctuation' && tokens[k].value === ')') depth -= 1;
    else if (depth === 0 && tokens[k].type === 'punctuation' && tokens[k].value === ',') { inspectRange(start, k); start = k + 1; }
  }
  inspectRange(start, close);
  if (!names.length) return null;
  return { sql: stripped, names: names };
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var seq = sequencePreprocess(sql, source);
    if (seq) {
      var sequenceAst = baseApi.parseSql(source, seq.sql);
      if (!sequenceAst || sequenceAst.type !== 'CreateSequenceStatement') throw new SyntaxError('Sequence options require CREATE SEQUENCE');
      var sequenceCopy = Object.assign({}, sequenceAst, { options: seq.options });
      return deepFreeze(sequenceCopy);
    }
    var identity = identityPreprocess(sql, source);
    var auto = autoIncrementPreprocess(identity ? identity.sql : sql, source);
    var stripped = auto ? auto.sql : identity ? identity.sql : sql;
    var ast = baseApi.parseSql(source, stripped);
    if (!identity && !auto) return ast;
    if (!ast || ast.type !== 'CreateTableStatement') throw new SyntaxError('Identity/autoincrement semantics require CREATE TABLE');
    var copy = Object.assign({}, ast);
    var identityIndex = 0;
    copy.columns = ast.columns.map(function (column) {
      var c = Object.assign({}, column);
      if (c.identity && identity && identity.options[identityIndex]) {
        c.identity = Object.assign({}, c.identity, { options: identity.options[identityIndex++] });
      } else if (c.identity) identityIndex += 1;
      if (auto && auto.names.indexOf(String(c.name.parts[0])) !== -1) {
        if (source === 'mysql') c.autoIncrement = { strategy: 'mysql-auto-increment' };
        else {
          if (upper(c.dataType.name) !== 'INTEGER' || !c.primaryKey) throw new RangeError('SQLite AUTOINCREMENT requires an INTEGER PRIMARY KEY column');
          c.autoIncrement = { strategy: 'sqlite-rowid-autoincrement' };
        }
      }
      return c;
    });
    validate(copy, source);
    return deepFreeze(copy);
  }
  function validate(ast, source) {
    if (!isAdvanced(ast)) throw new TypeError('NuBloxSQL ddl-v11 AST requires sequence options, identity options or explicit autoincrement semantics');
    var base = cloneWithoutAdvanced(ast);
    baseApi.analyzeAst(base);
    if (ast.type === 'CreateSequenceStatement') {
      if (!ast.options || !Object.keys(ast.options).length) throw new TypeError('CREATE SEQUENCE options are required in ddl-v11');
      return ast;
    }
    ast.columns.forEach(function (column) {
      if (column.autoIncrement) {
        if (column.generated || column.identity || column.default) throw new RangeError('Autoincrement column cannot also be generated, identity or DEFAULT in ddl-v11');
        if (column.autoIncrement.strategy === 'mysql-auto-increment' && source && source !== 'mysql') throw new RangeError('MySQL AUTO_INCREMENT is a MySQL semantic family');
        if (column.autoIncrement.strategy === 'sqlite-rowid-autoincrement' && source && source !== 'sqlite') throw new RangeError('SQLite AUTOINCREMENT is a SQLite ROWID semantic family');
      }
      if (column.identity && column.identity.options && !Object.keys(column.identity.options).length) throw new RangeError('Identity sequence options cannot be empty');
    });
    return ast;
  }
  function analyzeAst(ast) {
    if (!isAdvanced(ast)) return baseApi.analyzeAst(ast);
    validate(ast, null);
    var base = baseApi.analyzeAst(cloneWithoutAdvanced(ast)); var set = Object.create(null);
    base.capabilities.forEach(function (path) { set[path] = true; });
    function addOptions(options) { Object.keys(options || {}).forEach(function (key) { if (OPTION_CAPABILITIES[key]) set[OPTION_CAPABILITIES[key]] = true; }); }
    if (ast.type === 'CreateSequenceStatement') addOptions(ast.options);
    else ast.columns.forEach(function (column) {
      if (column.identity && column.identity.options) { set['integrity.identitySequenceOptions'] = true; addOptions(column.identity.options); }
      if (column.autoIncrement) set[column.autoIncrement.strategy === 'mysql-auto-increment' ? 'integrity.mysqlAutoIncrement' : 'integrity.sqliteRowidAutoIncrement'] = true;
    });
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v11', capabilities: Object.keys(set).sort() });
  }
  function quote(dialect, node) { return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.'); }
  function typeSql(node) { return node.name + (node.modifiers && node.modifiers.length ? '(' + node.modifiers.join(', ') + ')' : ''); }
  function compileAst(dialect, ast) {
    if (!isAdvanced(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect); validate(ast, null);
    if (ast.type === 'CreateSequenceStatement') {
      if (target !== 'postgresql') throw new RangeError('ddl-v11 CREATE SEQUENCE options are PostgreSQL-only');
      var baseSeq = baseApi.compileAst(target, cloneWithoutAdvanced(ast));
      return deepFreeze({ dialect: target, sql: baseSeq.sql + ' ' + optionSql(ast.options), targetToSource: [] });
    }
    ast.columns.forEach(function (column) {
      if (column.autoIncrement && column.autoIncrement.strategy === 'mysql-auto-increment' && target !== 'mysql') throw new RangeError('MySQL AUTO_INCREMENT cannot be lowered automatically to ' + target);
      if (column.autoIncrement && column.autoIncrement.strategy === 'sqlite-rowid-autoincrement' && target !== 'sqlite') throw new RangeError('SQLite ROWID AUTOINCREMENT cannot be lowered automatically to ' + target);
      if (column.identity && column.identity.options && target !== 'postgresql') throw new RangeError('Identity sequence options are PostgreSQL-only in ddl-v11');
    });
    var compiled = baseApi.compileAst(target, cloneWithoutAdvanced(ast)); var sql = compiled.sql;
    ast.columns.forEach(function (column) {
      var prefix = quote(target, column.name) + ' ' + typeSql(column.dataType);
      if (column.identity && column.identity.options) {
        var mode = column.identity.mode === 'always' ? 'GENERATED ALWAYS AS IDENTITY' : 'GENERATED BY DEFAULT AS IDENTITY';
        var decorated = mode + ' (' + optionSql(column.identity.options) + ')';
        if (sql.indexOf(mode) < 0) throw new Error('Unable to locate ddl-v11 identity clause');
        sql = sql.replace(mode, decorated);
      }
      if (column.autoIncrement && column.autoIncrement.strategy === 'mysql-auto-increment') {
        if (sql.indexOf(prefix) < 0) throw new Error('Unable to locate MySQL AUTO_INCREMENT column');
        sql = sql.replace(prefix, prefix + ' AUTO_INCREMENT');
      }
      if (column.autoIncrement && column.autoIncrement.strategy === 'sqlite-rowid-autoincrement') {
        var pk = prefix + ' PRIMARY KEY';
        if (sql.indexOf(pk) < 0) throw new Error('Unable to locate SQLite INTEGER PRIMARY KEY column');
        sql = sql.replace(pk, pk + ' AUTOINCREMENT');
      }
    });
    return deepFreeze({ dialect: target, sql: sql, targetToSource: compiled.targetToSource ? compiled.targetToSource.slice() : [] });
  }
  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from); var target = normalizeDialect(to); var ast = parseSql(source, sql);
    if (!isAdvanced(ast)) return baseApi.transpileSql(source, target, sql, options);
    validate(ast, source);
    if (source !== target && (ast.type === 'CreateSequenceStatement' || ast.columns.some(function (column) { return !!column.autoIncrement || !!(column.identity && column.identity.options); }))) {
      throw new RangeError('ddl-v11 identity/autoincrement/sequence-option semantics require an explicit cross-dialect transformation');
    }
    var analysis = analyzeAst(ast); var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) throw new RangeError('DDL ddl-v11 transpilation is blocked by unsupported target capabilities');
    if (plan.requiresQualification && options.allowUnqualified !== true) throw new RangeError('DDL ddl-v11 transpilation requires runtime qualification');
    var transforms = plan.decisions.filter(function (entry) { return entry.action === 'emulate' || entry.action === 'rewrite'; });
    if (transforms.length) throw new RangeError('DDL ddl-v11 transpilation requires an explicit semantic transformation for: ' + transforms.map(function (entry) { return entry.path; }).join(', '));
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from:source, to:target, scope:'ddl-v11', ast:ast, capabilities:analysis.capabilities, plan:plan, sql:compiled.sql, targetToSource:compiled.targetToSource, lossless:lossless, certified:plan.safeToProceed && lossless });
  }
  return Object.freeze({ parseSql:parseSql, analyzeAst:analyzeAst, compileAst:compileAst, transpileSql:transpileSql });
}
exports.create = create;
exports.isAdvancedAst = isAdvanced;
exports.OPTION_CAPABILITIES = OPTION_CAPABILITIES;

'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var ACTION_CAPABILITY = Object.freeze({
  AddColumnAction: 'schema.tableAlter.addColumn',
  DropColumnAction: 'schema.tableAlter.dropColumn',
  RenameColumnAction: 'schema.tableAlter.renameColumn',
  RenameTableAction: 'schema.tableAlter.renameTable'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function upper(value) { return String(value || '').toUpperCase(); }
function isWord(token, value) {
  return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value;
}
function isAlterAst(ast) { return !!(ast && ast.type === 'AlterTableStatement' && ast.action && ACTION_CAPABILITY[ast.action.type]); }

function create(baseApi, normalizeDialect, rewriteApi) {
  function parser(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect);
    var p = 0;
    function peek(offset) { return tokens[p + (offset || 0)]; }
    function take() { return tokens[p++]; }
    function word(value, offset) { return isWord(peek(offset), value); }
    function fail(message, token) {
      token = token || peek();
      var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
      error.position = token ? token.start : sql.length;
      throw error;
    }
    function expectWord(value, message) { if (!word(value)) fail(message || ('Expected ' + value)); return take(); }
    function identifier(simple) {
      var token = peek();
      if (!token || token.type !== 'identifier') fail('Expected identifier', token);
      var parts = [take().value];
      while (peek() && peek().type === 'punctuation' && peek().value === '.' && peek(1) && peek(1).type === 'identifier') {
        take(); parts.push(take().value);
      }
      if (simple && parts.length !== 1) fail('Expected unqualified identifier', token);
      return { type: 'Identifier', parts: parts };
    }
    function endIndex() {
      var end = tokens.length - 1;
      if (end > 0 && tokens[end - 1].type === 'punctuation' && tokens[end - 1].value === ';') end -= 1;
      return end;
    }
    function fragment(start, end) {
      if (end <= start) fail('Expected ALTER TABLE definition', tokens[start] || peek());
      return sql.slice(tokens[start].start, tokens[end - 1].end);
    }
    function finish(end) {
      if (p !== end) fail('Unexpected ALTER TABLE SQL', tokens[p]);
    }
    function parseColumnDefinition(start, end) {
      var synthetic = baseApi.parseSql(dialect, 'CREATE TABLE __nublox_alter_column (' + fragment(start, end) + ')');
      if (!synthetic || synthetic.type !== 'CreateTableStatement' || synthetic.columns.length !== 1 || synthetic.constraints.length !== 0) {
        fail('ALTER TABLE ADD COLUMN requires exactly one column definition', tokens[start]);
      }
      var column = synthetic.columns[0];
      if (column.nullable !== null || column.default || column.primaryKey || column.unique || column.checks.length || column.references) {
        fail('ddl-v2 ADD COLUMN currently supports a plain column type without constraints or defaults', tokens[start]);
      }
      return column;
    }

    if (!word('ALTER') || !word('TABLE', 1)) return null;
    var end = endIndex();
    expectWord('ALTER'); expectWord('TABLE');
    var table = identifier(false);
    var action;

    if (word('ADD')) {
      take(); if (word('COLUMN')) take();
      action = { type: 'AddColumnAction', column: parseColumnDefinition(p, end) };
      p = end;
    } else if (word('DROP')) {
      take(); if (word('COLUMN')) take();
      var drop = identifier(true);
      action = { type: 'DropColumnAction', column: drop };
      finish(end);
    } else if (word('RENAME')) {
      take();
      if (word('COLUMN')) {
        take();
        var from = identifier(true);
        expectWord('TO', 'ALTER TABLE RENAME COLUMN requires TO');
        var to = identifier(true);
        action = { type: 'RenameColumnAction', from: from, to: to };
      } else {
        expectWord('TO', 'ALTER TABLE RENAME requires TO or RENAME COLUMN');
        action = { type: 'RenameTableAction', to: identifier(true) };
      }
      finish(end);
    } else {
      fail('ddl-v2 supports ADD COLUMN, DROP COLUMN, RENAME COLUMN and RENAME TO');
    }

    return { type: 'AlterTableStatement', table: table, action: action };
  }

  function validateIdentifier(node, label, simple) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
    if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be unqualified');
  }

  function validate(ast) {
    if (!isAlterAst(ast)) throw new TypeError('NuBloxSQL ddl-v2 AST requires an AlterTableStatement with a supported action');
    validateIdentifier(ast.table, 'ALTER TABLE target', false);
    if (ast.action.type === 'AddColumnAction') {
      var column = ast.action.column;
      if (!column || column.type !== 'ColumnDefinition') throw new TypeError('ADD COLUMN requires a ColumnDefinition');
      validateIdentifier(column.name, 'ADD COLUMN name', true);
      if (column.nullable !== null || column.default || column.primaryKey || column.unique || column.checks.length || column.references) {
        throw new RangeError('ddl-v2 ADD COLUMN currently supports a plain column type without constraints or defaults');
      }
    } else if (ast.action.type === 'DropColumnAction') validateIdentifier(ast.action.column, 'DROP COLUMN name', true);
    else if (ast.action.type === 'RenameColumnAction') {
      validateIdentifier(ast.action.from, 'RENAME COLUMN source', true);
      validateIdentifier(ast.action.to, 'RENAME COLUMN target', true);
      if (String(ast.action.from.parts[0]).toLowerCase() === String(ast.action.to.parts[0]).toLowerCase()) throw new RangeError('RENAME COLUMN source and target must differ');
    } else {
      validateIdentifier(ast.action.to, 'RENAME TABLE target', true);
      var currentName = ast.table.parts[ast.table.parts.length - 1];
      if (String(currentName).toLowerCase() === String(ast.action.to.parts[0]).toLowerCase()) throw new RangeError('RENAME TABLE source and target must differ');
    }
    return ast;
  }

  function quote(dialect, node) {
    validateIdentifier(node, 'ALTER identifier', false);
    return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.');
  }

  function columnSql(dialect, column) {
    var synthetic = {
      type: 'CreateTableStatement',
      name: { type: 'Identifier', parts: ['__nublox_alter_column'] },
      columns: [column],
      constraints: []
    };
    var compiled = baseApi.compileAst(dialect, synthetic);
    var open = compiled.sql.indexOf('(');
    var close = compiled.sql.lastIndexOf(')');
    if (open < 0 || close <= open) throw new Error('Unexpected CREATE TABLE output while compiling ADD COLUMN');
    return compiled.sql.slice(open + 1, close).trim();
  }

  function analyzeAst(ast) {
    if (!isAlterAst(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var capabilities = [ACTION_CAPABILITY[ast.action.type]];
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v2', capabilities: capabilities });
  }

  function compileAst(dialect, ast) {
    if (!isAlterAst(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect);
    validate(ast);
    var sql = 'ALTER TABLE ' + quote(target, ast.table) + ' ';
    if (ast.action.type === 'AddColumnAction') sql += 'ADD COLUMN ' + columnSql(target, ast.action.column);
    else if (ast.action.type === 'DropColumnAction') sql += 'DROP COLUMN ' + quote(target, ast.action.column);
    else if (ast.action.type === 'RenameColumnAction') sql += 'RENAME COLUMN ' + quote(target, ast.action.from) + ' TO ' + quote(target, ast.action.to);
    else sql += 'RENAME TO ' + quote(target, ast.action.to);
    return deepFreeze({ dialect: target, sql: sql, targetToSource: [] });
  }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var ast = parser(sql, source);
    if (!ast) return baseApi.parseSql(source, sql);
    validate(ast);
    return deepFreeze(ast);
  }

  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from); var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    if (!isAlterAst(ast)) return baseApi.transpileSql(source, target, sql, options);
    var analysis = analyzeAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('ALTER TABLE transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('ALTER TABLE transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate' || (entry.action === 'rewrite' && entry.level === 'equivalent'); })) {
      throw new RangeError('ALTER TABLE transpilation requires an explicit semantic transformation');
    }
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: 'ddl-v2', ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: [], lossless: lossless, certified: plan.safeToProceed && lossless });
  }

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isAlterAst = isAlterAst;
exports.ACTION_CAPABILITY = ACTION_CAPABILITY;

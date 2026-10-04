'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');
var ForeignKeySemantics = require('./ForeignKeySemantics');

var ACTION_CAPABILITY = Object.freeze({
  AlterColumnTypeAction: 'schema.tableAlter.alterColumnType',
  SetColumnDefaultAction: 'schema.tableAlter.setDefault',
  DropColumnDefaultAction: 'schema.tableAlter.dropDefault',
  SetColumnNotNullAction: 'schema.tableAlter.setNotNull',
  DropColumnNotNullAction: 'schema.tableAlter.dropNotNull',
  AddConstraintAction: 'schema.tableAlter.addConstraint',
  DropConstraintAction: 'schema.tableAlter.dropConstraint'
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
function isAst(ast) {
  return !!(ast && ast.type === 'AlterTableStatement' && ast.action && ACTION_CAPABILITY[ast.action.type]);
}
function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) { value.forEach(function (entry) { walk(entry, visitor); }); return; }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}

function fakeSelect(expressions) {
  return {
    type: 'SelectStatement', with: null, distinct: false, columns: expressions.slice(), from: null,
    joins: [], where: null, groupBy: [], having: null, windows: [], orderBy: [], limit: null, offset: null
  };
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function parseExtended(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect);
    var p = 0;
    function peek(offset) { return tokens[p + (offset || 0)]; }
    function take() { return tokens[p++]; }
    function word(value, offset) { return isWord(peek(offset), value); }
    function punctuation(value, offset) { var t = peek(offset); return !!t && t.type === 'punctuation' && t.value === value; }
    function fail(message, token) {
      token = token || peek();
      var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
      error.position = token ? token.start : sql.length;
      throw error;
    }
    function expectWord(value, message) { if (!word(value)) fail(message || ('Expected ' + value)); return take(); }
    function expectPunctuation(value, message) { if (!punctuation(value)) fail(message || ('Expected ' + value)); return take(); }
    function identifier(simple) {
      var token = peek();
      if (!token || token.type !== 'identifier') fail('Expected identifier', token);
      var parts = [take().value];
      while (punctuation('.') && peek(1) && peek(1).type === 'identifier') { take(); parts.push(take().value); }
      if (simple && parts.length !== 1) fail('Expected unqualified identifier', token);
      return { type: 'Identifier', parts: parts };
    }
    function identifierList() {
      var result = [];
      do {
        result.push(identifier(true));
        if (!punctuation(',')) break;
        take();
      } while (true);
      return result;
    }
    function endIndex() {
      var end = tokens.length - 1;
      if (end > 0 && tokens[end - 1].type === 'punctuation' && tokens[end - 1].value === ';') end -= 1;
      return end;
    }
    function fragment(start, end) {
      if (end <= start) fail('Expected ALTER TABLE fragment', tokens[start] || peek());
      return sql.slice(tokens[start].start, tokens[end - 1].end);
    }
    function matchingParen(openIndex, end) {
      var depth = 0;
      for (var i = openIndex; i < end; i += 1) {
        var token = tokens[i];
        if (token.type === 'punctuation' && token.value === '(') depth += 1;
        else if (token.type === 'punctuation' && token.value === ')') {
          depth -= 1;
          if (depth === 0) return i;
        }
      }
      fail('Unclosed parenthesis', tokens[openIndex]);
    }
    function finish(end) { if (p !== end) fail('Unexpected ALTER TABLE SQL', tokens[p]); }
    function parseExpression(start, end) {
      var parsed = baseApi.parseSql(dialect, 'SELECT ' + fragment(start, end));
      if (!parsed || parsed.type !== 'SelectStatement' || parsed.columns.length !== 1 || parsed.from) fail('Invalid ALTER TABLE expression', tokens[start]);
      var expression = parsed.columns[0];
      if (expression.type === 'AliasedExpression') fail('ALTER TABLE expression cannot have an alias', tokens[start]);
      walk(expression, function (node) {
        if (node.type === 'Parameter') fail('ALTER TABLE expressions cannot contain bind parameters', tokens[start]);
        if (node.type === 'WindowExpression' || node.type === 'SubqueryExpression' || node.type === 'Wildcard') fail('Unsupported ALTER TABLE expression', tokens[start]);
      });
      return expression;
    }
    function parseType(start, end) {
      var synthetic = baseApi.parseSql(dialect, 'CREATE TABLE __nublox_type_probe (__c ' + fragment(start, end) + ')');
      if (!synthetic || synthetic.type !== 'CreateTableStatement' || synthetic.columns.length !== 1) fail('Invalid ALTER COLUMN type', tokens[start]);
      return synthetic.columns[0].dataType;
    }
    function parseConstraint(end) {
      if (word('PRIMARY')) {
        take(); expectWord('KEY'); expectPunctuation('(');
        var pk = identifierList(); expectPunctuation(')'); finish(end);
        return { type: 'PrimaryKeyConstraint', columns: pk };
      }
      if (word('UNIQUE')) {
        take(); expectPunctuation('(');
        var unique = identifierList(); expectPunctuation(')'); finish(end);
        return { type: 'UniqueConstraint', columns: unique };
      }
      if (word('CHECK')) {
        take(); expectPunctuation('(');
        var open = p - 1; var close = matchingParen(open, end);
        var expression = parseExpression(p, close); p = close + 1; finish(end);
        return { type: 'CheckConstraint', expression: expression };
      }
      if (word('FOREIGN')) {
        take(); expectWord('KEY'); expectPunctuation('(');
        var columns = identifierList(); expectPunctuation(')'); expectWord('REFERENCES');
        var table = identifier(false); expectPunctuation('(');
        var refs = identifierList(); expectPunctuation(')');
        var semantics = ForeignKeySemantics.parseTail({
          word: function (value) {
            var token = tokens[p];
            return !!token && upper(token.value !== null && token.value !== undefined ? token.value : token.raw) === value;
          },
          take: take,
          fail: function (message) { fail(message, tokens[p]); },
          atEnd: function () { return p >= end; }
        });
        finish(end);
        var reference = { type: 'ForeignKeyReference', table: table, columns: refs };
        Object.keys(semantics).forEach(function (key) { reference[key] = semantics[key]; });
        return { type: 'ForeignKeyConstraint', columns: columns, references: reference };
      }
      fail('ddl-v3 ADD CONSTRAINT supports PRIMARY KEY, UNIQUE, CHECK and FOREIGN KEY constraints');
    }

    if (!word('ALTER') || !word('TABLE', 1)) return null;
    var end = endIndex();
    expectWord('ALTER'); expectWord('TABLE');
    var table = identifier(false);
    var action = null;

    if (word('ALTER')) {
      take(); if (word('COLUMN')) take();
      var column = identifier(true);
      if (word('TYPE')) {
        take(); action = { type: 'AlterColumnTypeAction', column: column, dataType: parseType(p, end) }; p = end;
      } else if (word('SET')) {
        take();
        if (word('DEFAULT')) { take(); action = { type: 'SetColumnDefaultAction', column: column, expression: parseExpression(p, end) }; p = end; }
        else if (word('NOT')) { take(); expectWord('NULL'); finish(end); action = { type: 'SetColumnNotNullAction', column: column }; }
        else return null;
      } else if (word('DROP')) {
        take();
        if (word('DEFAULT')) { take(); finish(end); action = { type: 'DropColumnDefaultAction', column: column }; }
        else if (word('NOT')) { take(); expectWord('NULL'); finish(end); action = { type: 'DropColumnNotNullAction', column: column }; }
        else return null;
      } else return null;
    } else if (word('ADD') && word('CONSTRAINT', 1)) {
      take(); take();
      var name = identifier(true);
      action = { type: 'AddConstraintAction', name: name, constraint: parseConstraint(end) };
    } else if (word('DROP') && word('CONSTRAINT', 1)) {
      take(); take();
      action = { type: 'DropConstraintAction', name: identifier(true) };
      finish(end);
    } else return null;

    return { type: 'AlterTableStatement', table: table, action: action };
  }

  function validateIdentifier(node, label, simple) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
    if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be unqualified');
  }
  function validateExpression(expression) {
    if (!expression || typeof expression !== 'object') throw new TypeError('ALTER TABLE expression is invalid');
    walk(expression, function (node) {
      if (node.type === 'Parameter') throw new RangeError('ALTER TABLE expressions cannot contain bind parameters');
      if (node.type === 'WindowExpression' || node.type === 'SubqueryExpression' || node.type === 'Wildcard') throw new RangeError('Unsupported ALTER TABLE expression');
    });
    baseApi.analyzeAst(fakeSelect([expression]));
  }
  function validateType(dataType) {
    if (!dataType || dataType.type !== 'TypeName' || typeof dataType.name !== 'string' || !/^[A-Z][A-Z0-9_ ]*$/.test(dataType.name)) throw new TypeError('ALTER COLUMN requires a structured TypeName');
    if (!Array.isArray(dataType.modifiers) || dataType.modifiers.some(function (value) { return !Number.isSafeInteger(value) || value < 0; })) throw new TypeError('ALTER COLUMN type modifiers are invalid');
  }
  function validateConstraint(constraint) {
    if (!constraint || typeof constraint !== 'object') throw new TypeError('ADD CONSTRAINT requires a constraint AST');
    if (constraint.type === 'PrimaryKeyConstraint' || constraint.type === 'UniqueConstraint') {
      if (!Array.isArray(constraint.columns) || !constraint.columns.length) throw new TypeError('Constraint requires at least one column');
      constraint.columns.forEach(function (column) { validateIdentifier(column, 'Constraint column', true); });
      return;
    }
    if (constraint.type === 'CheckConstraint') { validateExpression(constraint.expression); return; }
    if (constraint.type === 'ForeignKeyConstraint') {
      if (!Array.isArray(constraint.columns) || !constraint.columns.length) throw new TypeError('FOREIGN KEY requires columns');
      constraint.columns.forEach(function (column) { validateIdentifier(column, 'FOREIGN KEY column', true); });
      if (!constraint.references || constraint.references.type !== 'ForeignKeyReference') throw new TypeError('FOREIGN KEY requires REFERENCES');
      validateIdentifier(constraint.references.table, 'REFERENCES table', false);
      if (!Array.isArray(constraint.references.columns) || constraint.references.columns.length !== constraint.columns.length) throw new RangeError('FOREIGN KEY referenced-column width must match local-column width');
      constraint.references.columns.forEach(function (column) { validateIdentifier(column, 'REFERENCES column', true); });
      ForeignKeySemantics.validate(constraint.references);
      return;
    }
    throw new RangeError('Unsupported ADD CONSTRAINT kind: ' + String(constraint.type));
  }
  function validate(ast) {
    if (!isAst(ast)) throw new TypeError('NuBloxSQL ddl-v3 AST requires an AlterTableStatement with a supported column/constraint action');
    validateIdentifier(ast.table, 'ALTER TABLE target', false);
    var action = ast.action;
    if (action.column) validateIdentifier(action.column, 'ALTER COLUMN target', true);
    if (action.type === 'AlterColumnTypeAction') validateType(action.dataType);
    if (action.type === 'SetColumnDefaultAction') validateExpression(action.expression);
    if (action.type === 'AddConstraintAction') { validateIdentifier(action.name, 'Constraint name', true); validateConstraint(action.constraint); }
    if (action.type === 'DropConstraintAction') validateIdentifier(action.name, 'Constraint name', true);
    return ast;
  }

  function validateSourceDialect(dialect, ast) {
    if (dialect === 'sqlite') throw new SyntaxError('ddl-v3 ALTER COLUMN/CONSTRAINT syntax is not valid SQLite source syntax');
    if (dialect === 'mysql' && ast.action.type !== 'SetColumnDefaultAction' && ast.action.type !== 'DropColumnDefaultAction' && !ForeignKeySemantics.isForeignKeyAdd(ast)) {
      throw new SyntaxError('ddl-v3 only accepts MySQL ALTER COLUMN SET/DROP DEFAULT or foreign-key ADD CONSTRAINT source syntax; other lifecycle operations use different MySQL semantics');
    }
  }
  function validateTargetDialect(dialect, ast) {
    if (dialect === 'sqlite') throw new RangeError('ddl-v3 column/constraint lifecycle requires a table-rebuild strategy for SQLite');
    if (dialect === 'mysql' && ast.action.type !== 'SetColumnDefaultAction' && ast.action.type !== 'DropColumnDefaultAction' && !ForeignKeySemantics.isForeignKeyAdd(ast)) {
      throw new RangeError('ddl-v3 cannot render this lifecycle operation to MySQL without an explicit semantic transformation');
    }
  }

  function quote(dialect, node) {
    return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.');
  }
  function typeSql(dataType) {
    var sql = dataType.name;
    if (dataType.modifiers.length) sql += '(' + dataType.modifiers.join(', ') + ')';
    return sql;
  }
  function expressionSql(dialect, expression) {
    var compiled = baseApi.compileAst(dialect, fakeSelect([expression]));
    if (compiled.sql.slice(0, 7) !== 'SELECT ') throw new Error('Unexpected expression compiler output for ddl-v3');
    return compiled.sql.slice(7);
  }
  function constraintSql(dialect, constraint) {
    function list(columns) { return columns.map(function (column) { return quote(dialect, column); }).join(', '); }
    if (constraint.type === 'PrimaryKeyConstraint') return 'PRIMARY KEY (' + list(constraint.columns) + ')';
    if (constraint.type === 'UniqueConstraint') return 'UNIQUE (' + list(constraint.columns) + ')';
    if (constraint.type === 'CheckConstraint') return 'CHECK (' + expressionSql(dialect, constraint.expression) + ')';
    return 'FOREIGN KEY (' + list(constraint.columns) + ') REFERENCES ' + quote(dialect, constraint.references.table) + ' (' + list(constraint.references.columns) + ')' + ForeignKeySemantics.suffix(constraint.references);
  }
  function addExpressionCapabilities(capabilities, expression) {
    if (!expression) return;
    baseApi.analyzeAst(fakeSelect([expression])).capabilities.forEach(function (path) {
      if (path !== 'statements.select' && capabilities.indexOf(path) === -1) capabilities.push(path);
    });
  }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var ast = parseExtended(sql, source);
    if (!ast) return baseApi.parseSql(source, sql);
    validate(ast); validateSourceDialect(source, ast);
    return deepFreeze(ast);
  }
  function analyzeAst(ast) {
    if (!isAst(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var capabilities = [ACTION_CAPABILITY[ast.action.type]];
    if (ast.action.type === 'SetColumnDefaultAction') addExpressionCapabilities(capabilities, ast.action.expression);
    if (ast.action.type === 'AddConstraintAction' && ast.action.constraint.type === 'CheckConstraint') addExpressionCapabilities(capabilities, ast.action.constraint.expression);
    capabilities.sort();
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v3', capabilities: capabilities });
  }
  function compileAst(dialect, ast) {
    if (!isAst(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect); validate(ast); validateTargetDialect(target, ast);
    var action = ast.action;
    var sql = 'ALTER TABLE ' + quote(target, ast.table) + ' ';
    if (action.type === 'AlterColumnTypeAction') sql += 'ALTER COLUMN ' + quote(target, action.column) + ' TYPE ' + typeSql(action.dataType);
    else if (action.type === 'SetColumnDefaultAction') sql += 'ALTER COLUMN ' + quote(target, action.column) + ' SET DEFAULT ' + expressionSql(target, action.expression);
    else if (action.type === 'DropColumnDefaultAction') sql += 'ALTER COLUMN ' + quote(target, action.column) + ' DROP DEFAULT';
    else if (action.type === 'SetColumnNotNullAction') sql += 'ALTER COLUMN ' + quote(target, action.column) + ' SET NOT NULL';
    else if (action.type === 'DropColumnNotNullAction') sql += 'ALTER COLUMN ' + quote(target, action.column) + ' DROP NOT NULL';
    else if (action.type === 'AddConstraintAction') sql += 'ADD CONSTRAINT ' + quote(target, action.name) + ' ' + constraintSql(target, action.constraint);
    else sql += 'DROP CONSTRAINT ' + quote(target, action.name);
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
      throw new RangeError('ALTER TABLE ddl-v3 transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('ALTER TABLE ddl-v3 transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate' || entry.action === 'rewrite'; })) {
      throw new RangeError('ALTER TABLE ddl-v3 transpilation requires an explicit semantic transformation');
    }
    validateTargetDialect(target, ast);
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: 'ddl-v3', ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: [], lossless: lossless, certified: plan.safeToProceed && lossless });
  }

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isAst = isAst;
exports.ACTION_CAPABILITY = ACTION_CAPABILITY;

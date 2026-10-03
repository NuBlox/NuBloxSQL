'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var DDL_TYPES = Object.freeze({
  CreateTableStatement: 'statements.createTable',
  CreateIndexStatement: 'statements.createIndex',
  CreateViewStatement: 'statements.createView',
  CreateSchemaStatement: 'statements.createSchema',
  CreateSequenceStatement: 'statements.createSequence',
  DropTableStatement: 'statements.dropTable',
  DropViewStatement: 'statements.dropView'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function upper(value) { return String(value || '').toUpperCase(); }
function isWordToken(token, value) {
  return !!token && (token.type === 'identifier' || token.type === 'keyword') && upper(token.value) === value;
}
function isDdlAst(ast) { return !!(ast && DDL_TYPES[ast.type]); }
function isQueryAst(ast) { return !!(ast && (ast.type === 'SelectStatement' || ast.type === 'SetOperationStatement')); }

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) { value.forEach(function (entry) { walk(entry, visitor); }); return; }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function createParser(sql, dialect) {
    var tokens = Tokenizer.tokenize(sql, dialect);
    var p = 0;

    function peek(offset) { return tokens[p + (offset || 0)]; }
    function take() { return tokens[p++]; }
    function word(value, offset) { return isWordToken(peek(offset), value); }
    function punctuation(value, offset) { var token = peek(offset); return !!token && token.type === 'punctuation' && token.value === value; }
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

    function statementEndIndex() {
      var end = tokens.length - 1;
      if (end > 0 && tokens[end - 1].type === 'punctuation' && tokens[end - 1].value === ';') end -= 1;
      return end;
    }

    function tokenRangeText(start, end) {
      if (end <= start) fail('Expected SQL fragment', tokens[start] || peek());
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

    function splitTopLevel(start, end) {
      var ranges = [];
      var depth = 0;
      var segment = start;
      for (var i = start; i < end; i += 1) {
        var token = tokens[i];
        if (token.type === 'punctuation' && token.value === '(') depth += 1;
        else if (token.type === 'punctuation' && token.value === ')') depth -= 1;
        else if (depth === 0 && token.type === 'punctuation' && token.value === ',') {
          if (segment === i) fail('Empty DDL definition', token);
          ranges.push([segment, i]); segment = i + 1;
        }
      }
      if (depth !== 0) fail('Unbalanced DDL parentheses', tokens[start]);
      if (segment >= end) fail('Empty DDL definition', tokens[end - 1]);
      ranges.push([segment, end]);
      return ranges;
    }

    function findConstraintBoundary(start, end) {
      var depth = 0;
      var words = { NOT: true, NULL: true, DEFAULT: true, PRIMARY: true, UNIQUE: true, CHECK: true, REFERENCES: true, CONSTRAINT: true };
      for (var i = start; i < end; i += 1) {
        var token = tokens[i];
        if (token.type === 'punctuation' && token.value === '(') depth += 1;
        else if (token.type === 'punctuation' && token.value === ')') depth -= 1;
        else if (depth === 0 && (token.type === 'identifier' || token.type === 'keyword') && words[upper(token.value)]) return i;
      }
      return end;
    }

    function expressionRange(start, end) {
      var parsed = baseApi.parseSql(dialect, 'SELECT ' + tokenRangeText(start, end));
      if (!parsed || parsed.type !== 'SelectStatement' || parsed.columns.length !== 1 || parsed.from) fail('Invalid DDL scalar expression', tokens[start]);
      var expression = parsed.columns[0];
      if (expression.type === 'AliasedExpression') fail('DDL scalar expression cannot have an alias', tokens[start]);
      walk(expression, function (node) {
        if (node.type === 'Parameter') fail('DDL expressions cannot contain bind parameters', tokens[start]);
        if (node.type === 'WindowExpression' || node.type === 'SubqueryExpression' || node.type === 'Wildcard') fail('Unsupported DDL scalar expression', tokens[start]);
      });
      return expression;
    }

    function parseTypeName(start, end) {
      if (start >= end) fail('Column requires a SQL type name', tokens[start]);
      var i = start;
      if (!tokens[i] || tokens[i].type !== 'identifier') fail('Expected SQL type name', tokens[i]);
      var words = [upper(tokens[i++].value)];
      if (i < end && tokens[i].type === 'identifier') {
        var pair = words[0] + ' ' + upper(tokens[i].value);
        if (pair === 'DOUBLE PRECISION' || pair === 'CHARACTER VARYING') words.push(upper(tokens[i++].value));
      }
      var modifiers = [];
      if (i < end && tokens[i].type === 'punctuation' && tokens[i].value === '(') {
        i += 1;
        while (i < end) {
          if (tokens[i].type !== 'number' || !Number.isSafeInteger(tokens[i].value) || tokens[i].value < 0) fail('SQL type modifier must be a non-negative integer', tokens[i]);
          modifiers.push(tokens[i++].value);
          if (i < end && tokens[i].type === 'punctuation' && tokens[i].value === ',') { i += 1; continue; }
          break;
        }
        if (i >= end || tokens[i].type !== 'punctuation' || tokens[i].value !== ')') fail('Expected ) after SQL type modifiers', tokens[i]);
        i += 1;
      }
      if (i !== end) fail('Unsupported SQL type declaration', tokens[i]);
      return { type: 'TypeName', name: words.join(' '), modifiers: modifiers };
    }

    function localIdentifierList(start, end) {
      var save = p; p = start;
      var result = identifierList();
      if (p !== end) fail('Unexpected token in identifier list', tokens[p]);
      p = save;
      return result;
    }

    function parseReferenceAt(start, end) {
      var save = p; p = start;
      expectWord('REFERENCES');
      var table = identifier(false);
      var columns = [];
      if (punctuation('(')) {
        take();
        var colStart = p;
        var close = matchingParen(p - 1, end);
        columns = localIdentifierList(colStart, close);
        p = close + 1;
      }
      if (p !== end) fail('dml-v1 foreign-key options beyond REFERENCES are not yet supported', tokens[p]);
      p = save;
      return { type: 'ForeignKeyReference', table: table, columns: columns };
    }

    function parseTableConstraint(start, end) {
      var save = p; p = start;
      var constraint;
      if (word('CONSTRAINT')) fail('Named constraints are outside ddl-v1', peek());
      if (word('PRIMARY')) {
        take(); expectWord('KEY'); expectPunctuation('(');
        var pkStart = p; var pkClose = matchingParen(p - 1, end);
        constraint = { type: 'PrimaryKeyConstraint', columns: localIdentifierList(pkStart, pkClose) }; p = pkClose + 1;
      } else if (word('UNIQUE')) {
        take(); expectPunctuation('(');
        var uqStart = p; var uqClose = matchingParen(p - 1, end);
        constraint = { type: 'UniqueConstraint', columns: localIdentifierList(uqStart, uqClose) }; p = uqClose + 1;
      } else if (word('CHECK')) {
        take(); expectPunctuation('(');
        var checkStart = p; var checkClose = matchingParen(p - 1, end);
        constraint = { type: 'CheckConstraint', expression: expressionRange(checkStart, checkClose) }; p = checkClose + 1;
      } else if (word('FOREIGN')) {
        take(); expectWord('KEY'); expectPunctuation('(');
        var fkStart = p; var fkClose = matchingParen(p - 1, end);
        var columns = localIdentifierList(fkStart, fkClose); p = fkClose + 1;
        var refStart = p;
        constraint = { type: 'ForeignKeyConstraint', columns: columns, references: parseReferenceAt(refStart, end) };
        p = end;
      } else {
        p = save; return null;
      }
      if (p !== end) fail('Unexpected table-constraint SQL', tokens[p]);
      p = save;
      return constraint;
    }

    function parseColumn(start, end) {
      var save = p; p = start;
      var name = identifier(true);
      var typeEnd = findConstraintBoundary(p, end);
      var dataType = parseTypeName(p, typeEnd);
      p = typeEnd;
      var result = {
        type: 'ColumnDefinition', name: name, dataType: dataType, nullable: null, default: null,
        primaryKey: false, unique: false, checks: [], references: null
      };
      while (p < end) {
        if (word('NOT')) { take(); expectWord('NULL', 'Expected NULL after NOT'); result.nullable = false; continue; }
        if (word('NULL')) { take(); result.nullable = true; continue; }
        if (word('PRIMARY')) { take(); expectWord('KEY'); result.primaryKey = true; continue; }
        if (word('UNIQUE')) { take(); result.unique = true; continue; }
        if (word('DEFAULT')) {
          take(); var defaultStart = p; var defaultEnd = findConstraintBoundary(p, end);
          result.default = expressionRange(defaultStart, defaultEnd); p = defaultEnd; continue;
        }
        if (word('CHECK')) {
          take(); expectPunctuation('('); var checkStart = p; var checkClose = matchingParen(p - 1, end);
          result.checks.push(expressionRange(checkStart, checkClose)); p = checkClose + 1; continue;
        }
        if (word('REFERENCES')) {
          result.references = parseReferenceAt(p, end); p = end; continue;
        }
        if (word('CONSTRAINT')) fail('Named column constraints are outside ddl-v1', peek());
        fail('Unsupported column constraint', peek());
      }
      p = save;
      return result;
    }

    function parseCreateTable(end) {
      expectWord('CREATE'); expectWord('TABLE');
      var name = identifier(false);
      expectPunctuation('(', 'CREATE TABLE requires a parenthesized definition list');
      var open = p - 1; var close = matchingParen(open, end);
      var columns = []; var constraints = [];
      splitTopLevel(p, close).forEach(function (range) {
        var tableConstraint = parseTableConstraint(range[0], range[1]);
        if (tableConstraint) constraints.push(tableConstraint); else columns.push(parseColumn(range[0], range[1]));
      });
      p = close + 1;
      if (p !== end) fail('ddl-v1 does not support CREATE TABLE options after the definition list', tokens[p]);
      return { type: 'CreateTableStatement', name: name, columns: columns, constraints: constraints };
    }

    function parseCreateIndex(end, unique) {
      expectWord('CREATE'); if (unique) expectWord('UNIQUE'); expectWord('INDEX');
      var name = identifier(false); expectWord('ON'); var table = identifier(false); expectPunctuation('(');
      var open = p - 1; var close = matchingParen(open, end);
      var columns = localIdentifierList(p, close); p = close + 1;
      var where = null;
      if (word('WHERE')) { take(); where = expressionRange(p, end); p = end; }
      if (p !== end) fail('Unsupported CREATE INDEX option', tokens[p]);
      return { type: 'CreateIndexStatement', name: name, table: table, columns: columns, unique: !!unique, where: where };
    }

    function parseCreateView(end) {
      expectWord('CREATE'); expectWord('VIEW'); var name = identifier(false); expectWord('AS');
      var query = baseApi.parseSql(dialect, tokenRangeText(p, end));
      if (!isQueryAst(query)) fail('CREATE VIEW requires a SELECT query', tokens[p]);
      walk(query, function (node) { if (node.type === 'Parameter') fail('CREATE VIEW cannot contain bind parameters', tokens[p]); });
      p = end;
      return { type: 'CreateViewStatement', name: name, query: query };
    }

    function parseSimpleCreate(end, kind) {
      expectWord('CREATE'); expectWord(kind);
      var name = identifier(false);
      if (p !== end) fail('ddl-v1 supports only basic CREATE ' + kind + ' syntax', tokens[p]);
      return { type: kind === 'SCHEMA' ? 'CreateSchemaStatement' : 'CreateSequenceStatement', name: name };
    }

    function parseDrop(end, kind) {
      expectWord('DROP'); expectWord(kind); var name = identifier(false);
      if (p !== end) fail('ddl-v1 supports only basic DROP ' + kind + ' syntax', tokens[p]);
      return { type: kind === 'TABLE' ? 'DropTableStatement' : 'DropViewStatement', name: name };
    }

    function parse() {
      var end = statementEndIndex();
      var ast = null;
      if (word('CREATE')) {
        if (word('TABLE', 1)) ast = parseCreateTable(end);
        else if (word('UNIQUE', 1) && word('INDEX', 2)) ast = parseCreateIndex(end, true);
        else if (word('INDEX', 1)) ast = parseCreateIndex(end, false);
        else if (word('VIEW', 1)) ast = parseCreateView(end);
        else if (word('SCHEMA', 1)) ast = parseSimpleCreate(end, 'SCHEMA');
        else if (word('SEQUENCE', 1)) ast = parseSimpleCreate(end, 'SEQUENCE');
      } else if (word('DROP')) {
        if (word('TABLE', 1)) ast = parseDrop(end, 'TABLE');
        else if (word('VIEW', 1)) ast = parseDrop(end, 'VIEW');
      }
      if (!ast) return null;
      p = end;
      if (tokens[p] && tokens[p].type === 'punctuation' && tokens[p].value === ';') p += 1;
      if (!tokens[p] || tokens[p].type !== 'eof') fail('Unexpected trailing DDL SQL', tokens[p]);
      return ast;
    }

    return { parse: parse };
  }

  function validateIdentifier(node, label, simple) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
    if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be unqualified');
  }

  function validateTypeName(node) {
    if (!node || node.type !== 'TypeName' || typeof node.name !== 'string' || !/^[A-Z][A-Z0-9_ ]*$/.test(node.name)) throw new TypeError('Invalid DDL SQL type');
    if (!Array.isArray(node.modifiers)) throw new TypeError('DDL SQL type modifiers must be an array');
    node.modifiers.forEach(function (modifier) { if (!Number.isSafeInteger(modifier) || modifier < 0) throw new RangeError('DDL SQL type modifier must be a non-negative safe integer'); });
  }

  function validateScalar(expression, label) {
    if (!expression || typeof expression !== 'object') throw new TypeError(label + ' must be an SQL expression');
    baseApi.analyzeAst({ type: 'SelectStatement', with: null, distinct: false, columns: [expression], from: null, joins: [], where: null, groupBy: [], having: null, windows: [], orderBy: [], limit: null, offset: null });
    walk(expression, function (node) {
      if (node.type === 'Parameter') throw new RangeError(label + ' cannot contain bind parameters');
      if (node.type === 'WindowExpression' || node.type === 'SubqueryExpression' || node.type === 'Wildcard') throw new RangeError(label + ' contains an unsupported expression');
    });
  }

  function validateColumnList(columns, label, known) {
    if (!Array.isArray(columns) || columns.length === 0) throw new TypeError(label + ' requires at least one column');
    var seen = Object.create(null);
    columns.forEach(function (column) {
      validateIdentifier(column, label + ' column', true);
      var key = String(column.parts[0]).toLowerCase();
      if (seen[key]) throw new RangeError(label + ' contains duplicate column ' + column.parts[0]);
      seen[key] = true;
      if (known && !known[key]) throw new RangeError(label + ' references unknown local column ' + column.parts[0]);
    });
  }

  function validateReference(reference, label) {
    if (!reference || reference.type !== 'ForeignKeyReference') throw new TypeError(label + ' requires a foreign-key reference');
    validateIdentifier(reference.table, label + ' table', false);
    if (!Array.isArray(reference.columns)) throw new TypeError(label + ' referenced columns must be an array');
    reference.columns.forEach(function (column) { validateIdentifier(column, label + ' referenced column', true); });
  }

  function validateDdlAst(ast) {
    if (!isDdlAst(ast)) throw new TypeError('NuBloxSQL DDL AST requires a ddl-v1 statement');
    if (ast.name) validateIdentifier(ast.name, 'DDL object name', false);

    if (ast.type === 'CreateTableStatement') {
      if (!Array.isArray(ast.columns) || ast.columns.length === 0) throw new TypeError('CREATE TABLE requires at least one column');
      if (!Array.isArray(ast.constraints)) throw new TypeError('CREATE TABLE constraints must be an array');
      var known = Object.create(null); var primaryKeys = 0;
      ast.columns.forEach(function (column) {
        if (!column || column.type !== 'ColumnDefinition') throw new TypeError('Invalid CREATE TABLE column definition');
        validateIdentifier(column.name, 'Column name', true); validateTypeName(column.dataType);
        var key = String(column.name.parts[0]).toLowerCase();
        if (known[key]) throw new RangeError('Duplicate CREATE TABLE column ' + column.name.parts[0]);
        known[key] = true;
        if (column.nullable !== null && typeof column.nullable !== 'boolean') throw new TypeError('Column nullable state must be boolean or null');
        if (column.default) validateScalar(column.default, 'Column DEFAULT');
        if (column.primaryKey) primaryKeys += 1;
        if (!Array.isArray(column.checks)) throw new TypeError('Column checks must be an array');
        column.checks.forEach(function (check) { validateScalar(check, 'Column CHECK'); });
        if (column.references) validateReference(column.references, 'Column REFERENCES');
      });
      ast.constraints.forEach(function (constraint) {
        if (!constraint || typeof constraint !== 'object') throw new TypeError('Invalid table constraint');
        if (constraint.type === 'PrimaryKeyConstraint') { primaryKeys += 1; validateColumnList(constraint.columns, 'PRIMARY KEY', known); }
        else if (constraint.type === 'UniqueConstraint') validateColumnList(constraint.columns, 'UNIQUE', known);
        else if (constraint.type === 'CheckConstraint') validateScalar(constraint.expression, 'Table CHECK');
        else if (constraint.type === 'ForeignKeyConstraint') {
          validateColumnList(constraint.columns, 'FOREIGN KEY', known); validateReference(constraint.references, 'FOREIGN KEY REFERENCES');
          if (constraint.references.columns.length && constraint.references.columns.length !== constraint.columns.length) throw new RangeError('FOREIGN KEY local/referenced column counts must match');
        } else throw new RangeError('Unsupported table constraint type ' + constraint.type);
      });
      if (primaryKeys > 1) throw new RangeError('CREATE TABLE cannot declare more than one primary key');
      return ast;
    }

    if (ast.type === 'CreateIndexStatement') {
      validateIdentifier(ast.table, 'CREATE INDEX table', false);
      validateColumnList(ast.columns, 'CREATE INDEX', null);
      if (typeof ast.unique !== 'boolean') throw new TypeError('CREATE INDEX unique must be boolean');
      if (ast.where) validateScalar(ast.where, 'CREATE INDEX WHERE');
      return ast;
    }

    if (ast.type === 'CreateViewStatement') {
      if (!isQueryAst(ast.query)) throw new TypeError('CREATE VIEW query must be a query AST');
      baseApi.analyzeAst(ast.query);
      walk(ast.query, function (node) { if (node.type === 'Parameter') throw new RangeError('CREATE VIEW cannot contain bind parameters'); });
    }
    return ast;
  }

  function add(paths, path) { paths[path] = true; }
  function addExpressionCapabilities(paths, expression) {
    var analysis = baseApi.analyzeAst({ type: 'SelectStatement', with: null, distinct: false, columns: [expression], from: null, joins: [], where: null, groupBy: [], having: null, windows: [], orderBy: [], limit: null, offset: null });
    analysis.capabilities.forEach(function (path) { if (path !== 'statements.select') add(paths, path); });
  }

  function analyzeDdlAst(ast) {
    validateDdlAst(ast);
    var paths = Object.create(null); add(paths, DDL_TYPES[ast.type]);
    if (ast.type === 'CreateTableStatement') {
      ast.columns.forEach(function (column) {
        if (column.nullable === false) add(paths, 'integrity.notNull');
        if (column.primaryKey) add(paths, 'integrity.primaryKey');
        if (column.unique) add(paths, 'integrity.unique');
        if (column.default) addExpressionCapabilities(paths, column.default);
        if (column.checks.length) { add(paths, 'integrity.check'); column.checks.forEach(function (check) { addExpressionCapabilities(paths, check); }); }
        if (column.references) add(paths, 'integrity.foreignKey');
      });
      ast.constraints.forEach(function (constraint) {
        if (constraint.type === 'PrimaryKeyConstraint') add(paths, 'integrity.primaryKey');
        else if (constraint.type === 'UniqueConstraint') add(paths, 'integrity.unique');
        else if (constraint.type === 'CheckConstraint') { add(paths, 'integrity.check'); addExpressionCapabilities(paths, constraint.expression); }
        else if (constraint.type === 'ForeignKeyConstraint') add(paths, 'integrity.foreignKey');
      });
    } else if (ast.type === 'CreateIndexStatement') {
      if (ast.unique) add(paths, 'schema.uniqueIndex');
      if (ast.where) { add(paths, 'schema.partialIndex'); addExpressionCapabilities(paths, ast.where); }
    } else if (ast.type === 'CreateViewStatement') {
      baseApi.analyzeAst(ast.query).capabilities.forEach(function (path) { add(paths, path); });
    }
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v1', capabilities: Object.keys(paths).sort() });
  }

  function quoteIdentifier(dialect, node) {
    validateIdentifier(node, 'DDL identifier', false);
    return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.');
  }

  function typeSql(node) {
    validateTypeName(node);
    return node.name + (node.modifiers.length ? '(' + node.modifiers.join(', ') + ')' : '');
  }

  function compileDdlAst(dialect, ast) {
    validateDdlAst(ast);
    function expressionSql(expression) {
      var compiled = baseApi.compileAst(dialect, { type: 'SelectStatement', with: null, distinct: false, columns: [expression], from: null, joins: [], where: null, groupBy: [], having: null, windows: [], orderBy: [], limit: null, offset: null });
      if (compiled.targetToSource.length) throw new RangeError('DDL scalar compilation cannot contain bind parameters');
      if (compiled.sql.slice(0, 7) !== 'SELECT ') throw new Error('Unexpected DDL scalar compiler output');
      return compiled.sql.slice(7);
    }
    function referenceSql(reference) {
      var sql = 'REFERENCES ' + quoteIdentifier(dialect, reference.table);
      if (reference.columns.length) sql += ' (' + reference.columns.map(function (column) { return quoteIdentifier(dialect, column); }).join(', ') + ')';
      return sql;
    }
    function columnSql(column) {
      var sql = quoteIdentifier(dialect, column.name) + ' ' + typeSql(column.dataType);
      if (column.nullable === false) sql += ' NOT NULL';
      else if (column.nullable === true) sql += ' NULL';
      if (column.default) sql += ' DEFAULT ' + expressionSql(column.default);
      if (column.primaryKey) sql += ' PRIMARY KEY';
      if (column.unique) sql += ' UNIQUE';
      column.checks.forEach(function (check) { sql += ' CHECK (' + expressionSql(check) + ')'; });
      if (column.references) sql += ' ' + referenceSql(column.references);
      return sql;
    }
    function constraintSql(constraint) {
      if (constraint.type === 'PrimaryKeyConstraint') return 'PRIMARY KEY (' + constraint.columns.map(function (c) { return quoteIdentifier(dialect, c); }).join(', ') + ')';
      if (constraint.type === 'UniqueConstraint') return 'UNIQUE (' + constraint.columns.map(function (c) { return quoteIdentifier(dialect, c); }).join(', ') + ')';
      if (constraint.type === 'CheckConstraint') return 'CHECK (' + expressionSql(constraint.expression) + ')';
      return 'FOREIGN KEY (' + constraint.columns.map(function (c) { return quoteIdentifier(dialect, c); }).join(', ') + ') ' + referenceSql(constraint.references);
    }

    var sql;
    if (ast.type === 'CreateTableStatement') {
      var definitions = ast.columns.map(columnSql).concat(ast.constraints.map(constraintSql));
      sql = 'CREATE TABLE ' + quoteIdentifier(dialect, ast.name) + ' (' + definitions.join(', ') + ')';
    } else if (ast.type === 'CreateIndexStatement') {
      sql = 'CREATE ' + (ast.unique ? 'UNIQUE ' : '') + 'INDEX ' + quoteIdentifier(dialect, ast.name) + ' ON ' + quoteIdentifier(dialect, ast.table) + ' (' + ast.columns.map(function (column) { return quoteIdentifier(dialect, column); }).join(', ') + ')';
      if (ast.where) sql += ' WHERE ' + expressionSql(ast.where);
    } else if (ast.type === 'CreateViewStatement') {
      var compiledQuery = baseApi.compileAst(dialect, ast.query);
      if (compiledQuery.targetToSource.length) throw new RangeError('CREATE VIEW cannot compile bind parameters');
      sql = 'CREATE VIEW ' + quoteIdentifier(dialect, ast.name) + ' AS ' + compiledQuery.sql;
    } else if (ast.type === 'CreateSchemaStatement') sql = 'CREATE SCHEMA ' + quoteIdentifier(dialect, ast.name);
    else if (ast.type === 'CreateSequenceStatement') sql = 'CREATE SEQUENCE ' + quoteIdentifier(dialect, ast.name);
    else if (ast.type === 'DropTableStatement') sql = 'DROP TABLE ' + quoteIdentifier(dialect, ast.name);
    else sql = 'DROP VIEW ' + quoteIdentifier(dialect, ast.name);
    return deepFreeze({ dialect: dialect, sql: sql, targetToSource: [] });
  }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var parser = createParser(sql, source); var ast = parser.parse();
    if (!ast) return baseApi.parseSql(source, sql);
    validateDdlAst(ast); return deepFreeze(ast);
  }

  function analyzeAst(ast) { return isDdlAst(ast) ? analyzeDdlAst(ast) : baseApi.analyzeAst(ast); }
  function compileAst(dialect, ast) { return isDdlAst(ast) ? compileDdlAst(normalizeDialect(dialect), ast) : baseApi.compileAst(dialect, ast); }

  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from); var target = normalizeDialect(to); var ast = parseSql(source, sql);
    if (!isDdlAst(ast)) return baseApi.transpileSql(source, target, sql, options);
    var analysis = analyzeDdlAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate' })) throw new RangeError('DDL transpilation does not silently emulate target capabilities');
    var equivalent = plan.decisions.filter(function (entry) { return entry.action === 'rewrite' && entry.level === 'equivalent'; });
    if (equivalent.length) throw new RangeError('DDL transpilation requires an explicit semantic rewrite for: ' + equivalent.map(function (entry) { return entry.path; }).join(', '));
    var compiled = compileDdlAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: 'ddl-v1', ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: [], lossless: lossless, certified: plan.safeToProceed && lossless });
  }

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isDdlAst = isDdlAst;
exports.DDL_TYPES = DDL_TYPES;

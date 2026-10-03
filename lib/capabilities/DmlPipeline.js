'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

var DML_TYPES = Object.freeze({
  InsertStatement: 'statements.insert',
  UpdateStatement: 'statements.update',
  DeleteStatement: 'statements.delete'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function upper(value) { return String(value || '').toUpperCase(); }
function isWordToken(token, value) {
  if (!token || (token.type !== 'identifier' && token.type !== 'keyword')) return false;
  return upper(token.value) === value;
}
function isDmlAst(ast) { return !!(ast && DML_TYPES[ast.type]); }
function isQueryAst(ast) { return !!(ast && (ast.type === 'SelectStatement' || ast.type === 'SetOperationStatement')); }

function parameterStyle(token) {
  var raw = token && token.raw || '';
  if (raw[0] === '$' && /^\$\d+$/.test(raw)) return 'numbered-dollar';
  if (raw[0] === '?' && raw.length > 1) return 'qmark-numbered';
  if (raw[0] === ':' || raw[0] === '@' || (raw[0] === '$' && !/^\$\d+$/.test(raw))) return 'named';
  return 'qmark';
}

function cloneWithParameterTokens(value, sourceParameters, state) {
  if (Array.isArray(value)) return value.map(function (entry) { return cloneWithParameterTokens(entry, sourceParameters, state); });
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'Parameter') {
    var source = sourceParameters[state.index++];
    if (!source) throw new RangeError('DML parser parameter mapping is inconsistent');
    return { type: 'Parameter', binding: source.value, style: parameterStyle(source) };
  }
  var result = {};
  Object.keys(value).forEach(function (key) { result[key] = cloneWithParameterTokens(value[key], sourceParameters, state); });
  return result;
}

function fakeSelect(columns) {
  return {
    type: 'SelectStatement',
    with: null,
    distinct: false,
    columns: columns.slice(),
    from: null,
    joins: [],
    where: null,
    groupBy: [],
    having: null,
    windows: [],
    orderBy: [],
    limit: null,
    offset: null
  };
}

function createSourceParser(sql, dialect, queryApi) {
  var tokens = Tokenizer.tokenize(sql, dialect);
  var p = 0;

  function peek(offset) { return tokens[p + (offset || 0)]; }
  function take() { return tokens[p++]; }
  function word(value, offset) { return isWordToken(peek(offset), value); }
  function punctuation(value, offset) { var t = peek(offset); return !!t && t.type === 'punctuation' && t.value === value; }
  function operator(value, offset) { var t = peek(offset); return !!t && t.type === 'operator' && t.value === value; }
  function fail(message, token) {
    token = token || peek();
    var error = new SyntaxError(message + ' at character ' + (token ? token.start : sql.length));
    error.position = token ? token.start : sql.length;
    throw error;
  }
  function expectWord(value, message) { if (!word(value)) fail(message || ('Expected ' + value)); return take(); }
  function expectPunctuation(value, message) { if (!punctuation(value)) fail(message || ('Expected ' + value)); return take(); }

  function identifier(simple) {
    var parts = [];
    var token = peek();
    if (!token || token.type !== 'identifier') fail('Expected identifier', token);
    parts.push(take().value);
    while (punctuation('.') && peek(1) && peek(1).type === 'identifier') {
      take(); parts.push(take().value);
    }
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
    if (end <= start) fail('Expected SQL expression', tokens[start] || peek());
    return sql.slice(tokens[start].start, tokens[end - 1].end);
  }

  function parametersInRange(start, end) {
    return tokens.slice(start, end).filter(function (token) { return token.type === 'parameter'; });
  }

  function rebindParsed(value, start, end) {
    var sourceParameters = parametersInRange(start, end);
    var state = { index: 0 };
    var result = cloneWithParameterTokens(value, sourceParameters, state);
    if (state.index !== sourceParameters.length) throw new RangeError('DML parser did not consume every parameter marker');
    return result;
  }

  function parseExpressionListRange(start, end) {
    var fragment = tokenRangeText(start, end);
    var parsed = queryApi.parseSql(dialect, 'SELECT ' + fragment);
    if (!parsed || parsed.type !== 'SelectStatement' || !Array.isArray(parsed.columns) || parsed.columns.length === 0 || parsed.from) {
      fail('Invalid DML expression list', tokens[start]);
    }
    return rebindParsed(parsed.columns, start, end);
  }

  function parseExpressionRange(start, end) {
    var columns = parseExpressionListRange(start, end);
    if (columns.length !== 1) fail('Expected one SQL expression', tokens[start]);
    if (columns[0].type === 'AliasedExpression') fail('DML scalar expression cannot have an alias', tokens[start]);
    return columns[0];
  }

  function parseQueryRange(start, end) {
    var parsed = queryApi.parseSql(dialect, tokenRangeText(start, end));
    return rebindParsed(parsed, start, end);
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
        if (i === segment) fail('Empty DML expression', token);
        ranges.push([segment, i]);
        segment = i + 1;
      }
      if (depth < 0) fail('Unexpected closing parenthesis', token);
    }
    if (depth !== 0) fail('Unbalanced parentheses in DML expression', tokens[start]);
    if (segment >= end) fail('Empty DML expression', tokens[end - 1]);
    ranges.push([segment, end]);
    return ranges;
  }

  function findTopLevelWord(start, end, names) {
    var depth = 0;
    for (var i = start; i < end; i += 1) {
      var token = tokens[i];
      if (token.type === 'punctuation' && token.value === '(') depth += 1;
      else if (token.type === 'punctuation' && token.value === ')') depth -= 1;
      else if (depth === 0) {
        for (var n = 0; n < names.length; n += 1) {
          if (isWordToken(token, names[n])) return i;
        }
      }
    }
    return -1;
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

  function returningClause(end) {
    if (!word('RETURNING')) return [];
    take();
    var start = p;
    p = end;
    return parseExpressionListRange(start, end);
  }

  function finish(end) {
    if (p !== end) fail('Unexpected trailing DML SQL');
    if (punctuation(';')) take();
    if (!peek() || peek().type !== 'eof') fail('Unexpected trailing SQL');
  }

  function parseInsert() {
    var end = statementEndIndex();
    expectWord('INSERT');
    expectWord('INTO', 'INSERT requires INTO');
    var target = identifier(false);
    var columns = [];
    if (punctuation('(')) {
      take(); columns = identifierList(); expectPunctuation(')', 'Expected ) after INSERT column list');
    }

    var rows = [];
    var source = null;
    if (word('VALUES')) {
      take();
      do {
        expectPunctuation('(', 'VALUES requires a parenthesized row');
        var openIndex = p - 1;
        var closeIndex = matchingParen(openIndex, end);
        rows.push(parseExpressionListRange(p, closeIndex));
        p = closeIndex + 1;
        if (!punctuation(',')) break;
        take();
      } while (true);
    } else if (word('SELECT') || word('WITH')) {
      var returningIndex = findTopLevelWord(p, end, ['RETURNING']);
      var queryEnd = returningIndex >= 0 ? returningIndex : end;
      source = parseQueryRange(p, queryEnd);
      p = queryEnd;
    } else {
      fail('INSERT dml-v1 supports VALUES or a SELECT query source');
    }

    var returning = returningClause(end);
    finish(end);
    return {
      type: 'InsertStatement',
      target: target,
      columns: columns,
      rows: rows,
      source: source,
      returning: returning
    };
  }

  function parseAssignment(range) {
    var start = range[0];
    var end = range[1];
    var depth = 0;
    var equals = -1;
    for (var i = start; i < end; i += 1) {
      var token = tokens[i];
      if (token.type === 'punctuation' && token.value === '(') depth += 1;
      else if (token.type === 'punctuation' && token.value === ')') depth -= 1;
      else if (depth === 0 && token.type === 'operator' && token.value === '=') { equals = i; break; }
    }
    if (equals <= start || equals >= end - 1) fail('UPDATE assignment requires column = expression', tokens[start]);
    var save = p;
    p = start;
    var column = identifier(true);
    if (p !== equals) fail('UPDATE assignment target must be one unqualified column', tokens[start]);
    p = save;
    return { type: 'Assignment', column: column, value: parseExpressionRange(equals + 1, end) };
  }

  function parseUpdate() {
    var end = statementEndIndex();
    expectWord('UPDATE');
    var target = identifier(false);
    expectWord('SET', 'UPDATE requires SET');
    var assignmentsEnd = findTopLevelWord(p, end, ['WHERE', 'RETURNING']);
    if (assignmentsEnd < 0) assignmentsEnd = end;
    var assignmentRanges = splitTopLevel(p, assignmentsEnd);
    var assignments = assignmentRanges.map(parseAssignment);
    p = assignmentsEnd;

    var where = null;
    if (word('WHERE')) {
      take();
      var whereEnd = findTopLevelWord(p, end, ['RETURNING']);
      if (whereEnd < 0) whereEnd = end;
      where = parseExpressionRange(p, whereEnd);
      p = whereEnd;
    }

    var returning = returningClause(end);
    finish(end);
    return { type: 'UpdateStatement', target: target, assignments: assignments, where: where, returning: returning };
  }

  function parseDelete() {
    var end = statementEndIndex();
    expectWord('DELETE');
    expectWord('FROM', 'DELETE requires FROM');
    var target = identifier(false);
    var where = null;
    if (word('WHERE')) {
      take();
      var whereEnd = findTopLevelWord(p, end, ['RETURNING']);
      if (whereEnd < 0) whereEnd = end;
      where = parseExpressionRange(p, whereEnd);
      p = whereEnd;
    }
    var returning = returningClause(end);
    finish(end);
    return { type: 'DeleteStatement', target: target, where: where, returning: returning };
  }

  function parse() {
    if (word('INSERT')) return parseInsert();
    if (word('UPDATE')) return parseUpdate();
    if (word('DELETE')) return parseDelete();
    return null;
  }

  return { parse: parse };
}

function createBinder(dialect) {
  var targetToSource = [];
  var assigned = Object.create(null);
  var next = 1;
  function key(binding) { return typeof binding + ':' + String(binding); }
  function marker(binding) {
    if (dialect === 'mysql') {
      targetToSource.push(binding);
      return '?';
    }
    var k = key(binding);
    if (!assigned[k]) assigned[k] = next++;
    var index = assigned[k];
    if (targetToSource[index - 1] === undefined) targetToSource[index - 1] = binding;
    return dialect === 'postgresql' ? '$' + index : '?' + index;
  }
  return { marker: marker, targetToSource: targetToSource };
}

function create(queryApi, normalizeDialect, rewriteApi) {
  function quoteIdentifier(dialect, node) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError('DML identifier is invalid');
    return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.');
  }

  function validateExpressionList(expressions, label) {
    if (!Array.isArray(expressions)) throw new TypeError(label + ' must be an array');
    expressions.forEach(function (expression) {
      if (!expression || typeof expression !== 'object') throw new TypeError(label + ' contains an invalid expression');
    });
    if (expressions.length) queryApi.analyzeAst(fakeSelect(expressions));
  }

  function rejectWindowExpressions(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'WindowExpression') throw new RangeError('dml-v1 does not permit window expressions inside DML scalar expressions');
    if (Array.isArray(value)) { value.forEach(rejectWindowExpressions); return; }
    Object.keys(value).forEach(function (key) { rejectWindowExpressions(value[key]); });
  }

  function validateIdentifier(node, label, simple) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
    if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be unqualified');
  }

  function validateDmlAst(ast) {
    if (!isDmlAst(ast)) throw new TypeError('NuBloxSQL DML AST requires InsertStatement, UpdateStatement or DeleteStatement');
    validateIdentifier(ast.target, 'DML target', false);
    if (!Array.isArray(ast.returning)) throw new TypeError('DML returning expressions must be an array');
    validateExpressionList(ast.returning, 'DML RETURNING');
    rejectWindowExpressions(ast.returning);

    if (ast.type === 'InsertStatement') {
      if (!Array.isArray(ast.columns)) throw new TypeError('INSERT columns must be an array');
      var columnNames = Object.create(null);
      ast.columns.forEach(function (column) {
        validateIdentifier(column, 'INSERT column', true);
        var name = String(column.parts[0]).toLowerCase();
        if (columnNames[name]) throw new RangeError('Duplicate INSERT column: ' + column.parts[0]);
        columnNames[name] = true;
      });
      if (!Array.isArray(ast.rows)) throw new TypeError('INSERT rows must be an array');
      var hasRows = ast.rows.length > 0;
      var hasSource = !!ast.source;
      if (hasRows === hasSource) throw new TypeError('INSERT requires exactly one VALUES source or SELECT source');
      if (hasRows) {
        var width = ast.rows[0].length;
        if (width === 0) throw new TypeError('INSERT VALUES row cannot be empty');
        ast.rows.forEach(function (row) {
          if (!Array.isArray(row) || row.length !== width) throw new RangeError('Every INSERT VALUES row must have the same width');
          if (ast.columns.length && row.length !== ast.columns.length) throw new RangeError('INSERT VALUES width must match the INSERT column list');
          validateExpressionList(row, 'INSERT VALUES row');
          rejectWindowExpressions(row);
        });
      }
      if (hasSource) {
        if (!isQueryAst(ast.source)) throw new TypeError('INSERT SELECT source must be a query AST');
        queryApi.analyzeAst(ast.source);
      }
      return ast;
    }

    if (ast.type === 'UpdateStatement') {
      if (!Array.isArray(ast.assignments) || ast.assignments.length === 0) throw new TypeError('UPDATE requires at least one assignment');
      var assigned = Object.create(null);
      ast.assignments.forEach(function (assignment) {
        if (!assignment || assignment.type !== 'Assignment') throw new TypeError('Invalid UPDATE assignment');
        validateIdentifier(assignment.column, 'UPDATE assignment column', true);
        var name = String(assignment.column.parts[0]).toLowerCase();
        if (assigned[name]) throw new RangeError('Duplicate UPDATE assignment column: ' + assignment.column.parts[0]);
        assigned[name] = true;
        validateExpressionList([assignment.value], 'UPDATE assignment');
        rejectWindowExpressions(assignment.value);
      });
      if (ast.where) { validateExpressionList([ast.where], 'UPDATE WHERE'); rejectWindowExpressions(ast.where); }
      return ast;
    }

    if (ast.where) { validateExpressionList([ast.where], 'DELETE WHERE'); rejectWindowExpressions(ast.where); }
    return ast;
  }

  function validateSourceSyntax(source, ast) {
    if (source === 'mysql' && ast.returning && ast.returning.length) throw new SyntaxError('RETURNING is not valid MySQL source syntax');
  }

  function add(set, path) { set[path] = true; }
  function addExpressionCapabilities(set, expressions) {
    if (!expressions || !expressions.length) return;
    var analysis = queryApi.analyzeAst(fakeSelect(expressions));
    analysis.capabilities.forEach(function (path) { if (path !== 'statements.select') add(set, path); });
  }

  function analyzeDmlAst(ast) {
    validateDmlAst(ast);
    var paths = Object.create(null);
    add(paths, DML_TYPES[ast.type]);
    if (ast.returning.length) add(paths, 'syntax.returning');
    addExpressionCapabilities(paths, ast.returning);

    if (ast.type === 'InsertStatement') {
      ast.rows.forEach(function (row) { addExpressionCapabilities(paths, row); });
      if (ast.source) queryApi.analyzeAst(ast.source).capabilities.forEach(function (path) { add(paths, path); });
    } else if (ast.type === 'UpdateStatement') {
      ast.assignments.forEach(function (assignment) { addExpressionCapabilities(paths, [assignment.value]); });
      if (ast.where) addExpressionCapabilities(paths, [ast.where]);
    } else if (ast.where) addExpressionCapabilities(paths, [ast.where]);

    return deepFreeze({ statementType: ast.type, scope: 'dml-v1', capabilities: Object.keys(paths).sort() });
  }

  function compileDmlAst(dialect, ast) {
    validateDmlAst(ast);
    var binder = createBinder(dialect);

    function rebindCompiled(compiled) {
      var tokens = Tokenizer.tokenize(compiled.sql, dialect);
      var output = '';
      var cursor = 0;
      var mysqlOccurrence = 0;
      tokens.forEach(function (token) {
        if (token.type !== 'parameter') return;
        output += compiled.sql.slice(cursor, token.start);
        var binding;
        if (dialect === 'mysql') binding = compiled.targetToSource[mysqlOccurrence++];
        else binding = compiled.targetToSource[Number(token.value) - 1];
        if (binding === undefined) throw new RangeError('Compiled DML parameter mapping is inconsistent');
        output += binder.marker(binding);
        cursor = token.end;
      });
      return output + compiled.sql.slice(cursor);
    }

    function expressionListSql(expressions) {
      if (!expressions.length) return '';
      var compiled = queryApi.compileAst(dialect, fakeSelect(expressions));
      var rebound = rebindCompiled(compiled);
      if (rebound.slice(0, 7) !== 'SELECT ') throw new Error('Unexpected expression compiler output');
      return rebound.slice(7);
    }

    function expressionSql(expression) { return expressionListSql([expression]); }
    function querySql(query) { return rebindCompiled(queryApi.compileAst(dialect, query)); }
    function returningSql(expressions) { return expressions.length ? ' RETURNING ' + expressionListSql(expressions) : ''; }

    var sql;
    if (ast.type === 'InsertStatement') {
      sql = 'INSERT INTO ' + quoteIdentifier(dialect, ast.target);
      if (ast.columns.length) sql += ' (' + ast.columns.map(function (column) { return quoteIdentifier(dialect, column); }).join(', ') + ')';
      if (ast.rows.length) {
        sql += ' VALUES ' + ast.rows.map(function (row) { return '(' + expressionListSql(row) + ')'; }).join(', ');
      } else sql += ' ' + querySql(ast.source);
      sql += returningSql(ast.returning);
    } else if (ast.type === 'UpdateStatement') {
      sql = 'UPDATE ' + quoteIdentifier(dialect, ast.target) + ' SET ' + ast.assignments.map(function (assignment) {
        return quoteIdentifier(dialect, assignment.column) + ' = ' + expressionSql(assignment.value);
      }).join(', ');
      if (ast.where) sql += ' WHERE ' + expressionSql(ast.where);
      sql += returningSql(ast.returning);
    } else {
      sql = 'DELETE FROM ' + quoteIdentifier(dialect, ast.target);
      if (ast.where) sql += ' WHERE ' + expressionSql(ast.where);
      sql += returningSql(ast.returning);
    }

    return deepFreeze({ dialect: dialect, sql: sql, targetToSource: binder.targetToSource.slice() });
  }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var parser = createSourceParser(sql, source, queryApi);
    var ast = parser.parse();
    if (!ast) return queryApi.parseSql(source, sql);
    validateDmlAst(ast);
    validateSourceSyntax(source, ast);
    return deepFreeze(ast);
  }

  function analyzeAst(ast) {
    if (!isDmlAst(ast)) return queryApi.analyzeAst(ast);
    return analyzeDmlAst(ast);
  }

  function compileAst(dialect, ast) {
    if (!isDmlAst(ast)) return queryApi.compileAst(dialect, ast);
    return compileDmlAst(normalizeDialect(dialect), ast);
  }

  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from);
    var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    var analysis = analyzeAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL AST transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL AST transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate'; }) && options.allowEmulation !== true) {
      throw new RangeError('SQL AST transpilation requires an explicit emulation strategy');
    }
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({
      from: source,
      to: target,
      scope: analysis.scope,
      ast: ast,
      capabilities: analysis.capabilities,
      plan: plan,
      sql: compiled.sql,
      targetToSource: compiled.targetToSource,
      lossless: lossless,
      certified: plan.safeToProceed && lossless
    });
  }

  return Object.freeze({
    parseSql: parseSql,
    analyzeAst: analyzeAst,
    compileAst: compileAst,
    transpileSql: transpileSql
  });
}

exports.create = create;
exports.isDmlAst = isDmlAst;
exports.validateDmlAst = function () { throw new Error('validateDmlAst is available through a created pipeline instance'); };

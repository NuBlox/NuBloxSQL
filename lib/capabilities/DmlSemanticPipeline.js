'use strict';

var Tokenizer = require('./Tokenizer');
var Compiler = require('./Compiler');

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
function parameterStyle(token) {
  var raw = token && token.raw || '';
  if (raw[0] === '$' && /^\$\d+$/.test(raw)) return 'numbered-dollar';
  if (raw[0] === '?' && raw.length > 1) return 'qmark-numbered';
  if (raw[0] === ':' || raw[0] === '@' || (raw[0] === '$' && !/^\$\d+$/.test(raw))) return 'named';
  return 'qmark';
}
function isSemanticAst(ast) { return !!(ast && (ast.type === 'UpsertStatement' || ast.type === 'MergeStatement')); }
function identifierName(node) {
  if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) return null;
  return String(node.parts[node.parts.length - 1]).toLowerCase();
}
function fakeSelect(columns) {
  return {
    type: 'SelectStatement', with: null, distinct: false, columns: columns.slice(), from: null, joins: [], where: null,
    groupBy: [], having: null, windows: [], orderBy: [], limit: null, offset: null
  };
}
function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) { value.forEach(function (entry) { walk(entry, visitor); }); return; }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}
function rebindParsed(value, sourceParameters) {
  var index = 0;
  function clone(node) {
    if (Array.isArray(node)) return node.map(clone);
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'Parameter') {
      var source = sourceParameters[index++];
      if (!source) throw new RangeError('DML semantic parser parameter mapping is inconsistent');
      return { type: 'Parameter', binding: source.value, style: parameterStyle(source) };
    }
    var result = {};
    Object.keys(node).forEach(function (key) { result[key] = clone(node[key]); });
    return result;
  }
  var result = clone(value);
  if (index !== sourceParameters.length) throw new RangeError('DML semantic parser did not consume every parameter marker');
  return result;
}

function createParser(sql, dialect, baseApi) {
  var tokens = Tokenizer.tokenize(sql, dialect);
  var end = tokens.length - 1;
  if (end > 0 && tokens[end - 1].type === 'punctuation' && tokens[end - 1].value === ';') end -= 1;
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
    var first = peek();
    if (!first || first.type !== 'identifier') fail('Expected identifier', first);
    var parts = [take().value];
    while (punctuation('.') && peek(1) && peek(1).type === 'identifier') { take(); parts.push(take().value); }
    if (simple && parts.length !== 1) fail('Expected unqualified identifier', first);
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
  function textRange(start, stop) {
    if (stop <= start) fail('Expected SQL expression', tokens[start]);
    return sql.slice(tokens[start].start, tokens[stop - 1].end);
  }
  function parameters(start, stop) { return tokens.slice(start, stop).filter(function (token) { return token.type === 'parameter'; }); }
  function findTopWord(start, stop, value) {
    var depth = 0;
    for (var i = start; i < stop; i += 1) {
      var token = tokens[i];
      if (token.type === 'punctuation' && token.value === '(') depth += 1;
      else if (token.type === 'punctuation' && token.value === ')') depth -= 1;
      else if (depth === 0 && isWordToken(token, value)) return i;
    }
    return -1;
  }
  function findTopSequence(start, stop, words) {
    var depth = 0;
    for (var i = start; i < stop; i += 1) {
      var token = tokens[i];
      if (token.type === 'punctuation' && token.value === '(') { depth += 1; continue; }
      if (token.type === 'punctuation' && token.value === ')') { depth -= 1; continue; }
      if (depth !== 0) continue;
      var matched = true;
      for (var j = 0; j < words.length; j += 1) if (!isWordToken(tokens[i + j], words[j])) { matched = false; break; }
      if (matched) return i;
    }
    return -1;
  }
  function matchingParen(openIndex, stop) {
    var depth = 0;
    for (var i = openIndex; i < stop; i += 1) {
      if (tokens[i].type === 'punctuation' && tokens[i].value === '(') depth += 1;
      else if (tokens[i].type === 'punctuation' && tokens[i].value === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    fail('Unclosed parenthesis', tokens[openIndex]);
  }
  function parseFake(fakeSql, start, stop) {
    return rebindParsed(baseApi.parseSql(dialect, fakeSql), parameters(start, stop));
  }
  function parseExpression(start, stop) {
    var parsed = parseFake('DELETE FROM __nublox_semantic WHERE ' + textRange(start, stop), start, stop);
    return parsed.where;
  }
  function parseAssignments(start, stop, whereStart) {
    var assignmentStop = whereStart >= 0 ? whereStart : stop;
    var source = 'UPDATE __nublox_semantic SET ' + textRange(start, assignmentStop);
    if (whereStart >= 0) source += ' WHERE ' + textRange(whereStart + 1, stop);
    var parsed = parseFake(source, start, stop);
    return { assignments: parsed.assignments, where: parsed.where };
  }
  function parseReturning(start, stop) {
    var parsed = parseFake('DELETE FROM __nublox_semantic RETURNING ' + textRange(start, stop), start, stop);
    return parsed.returning;
  }
  function parseValues(start, stop) {
    var parsed = parseFake('INSERT INTO __nublox_semantic VALUES (' + textRange(start, stop) + ')', start, stop);
    return parsed.rows[0];
  }
  function finish() {
    if (p !== end) fail('Unexpected trailing DML semantic SQL');
    if (tokens[end] && tokens[end].type === 'punctuation' && tokens[end].value === ';') p += 1;
  }

  function parseUpsert() {
    if (!word('INSERT')) return null;
    var onConflict = findTopSequence(0, end, ['ON', 'CONFLICT']);
    var onDuplicate = findTopSequence(0, end, ['ON', 'DUPLICATE', 'KEY', 'UPDATE']);
    var conflictIndex = onConflict >= 0 ? onConflict : onDuplicate;
    if (conflictIndex < 0) return null;

    if (dialect === 'mysql' && onDuplicate < 0) fail('MySQL upsert source syntax requires ON DUPLICATE KEY UPDATE', tokens[conflictIndex]);
    if (dialect !== 'mysql' && onConflict < 0) fail('PostgreSQL/SQLite upsert source syntax requires ON CONFLICT', tokens[conflictIndex]);

    var returningIndex = dialect === 'mysql' ? -1 : findTopWord(conflictIndex + 1, end, 'RETURNING');
    var conflictEnd = returningIndex >= 0 ? returningIndex : end;
    var baseInsert = baseApi.parseSql(dialect, sql.slice(0, tokens[conflictIndex].start));
    if (!baseInsert || baseInsert.type !== 'InsertStatement') fail('UPSERT requires an INSERT statement', tokens[0]);
    if (baseInsert.returning.length) fail('UPSERT RETURNING must follow the conflict clause', tokens[conflictIndex]);

    p = conflictIndex;
    var syntax;
    var target = [];
    var action;
    var assignments = [];
    var updateWhere = null;

    if (onConflict >= 0) {
      syntax = 'on-conflict';
      expectWord('ON'); expectWord('CONFLICT');
      if (punctuation('(')) {
        take(); target = identifierList(); expectPunctuation(')', 'Expected ) after ON CONFLICT target');
      }
      if (word('ON') || word('WHERE')) fail('dml-v2 supports column-list conflict targets only');
      expectWord('DO', 'ON CONFLICT requires DO');
      if (word('NOTHING')) { take(); action = 'nothing'; }
      else {
        expectWord('UPDATE', 'ON CONFLICT supports DO NOTHING or DO UPDATE');
        expectWord('SET', 'DO UPDATE requires SET');
        if (target.length === 0) fail('Portable DO UPDATE requires an explicit conflict column target');
        var whereIndex = findTopWord(p, conflictEnd, 'WHERE');
        var parsedUpdate = parseAssignments(p, conflictEnd, whereIndex);
        assignments = parsedUpdate.assignments;
        updateWhere = parsedUpdate.where;
        p = conflictEnd;
        action = 'update';
      }
    } else {
      syntax = 'on-duplicate-key';
      expectWord('ON'); expectWord('DUPLICATE'); expectWord('KEY'); expectWord('UPDATE');
      var parsedDuplicate = parseAssignments(p, conflictEnd, -1);
      assignments = parsedDuplicate.assignments;
      p = conflictEnd;
      action = 'update';
    }

    if (p !== conflictEnd) p = conflictEnd;
    var returning = [];
    if (returningIndex >= 0) {
      p = returningIndex;
      expectWord('RETURNING');
      returning = parseReturning(p, end);
      p = end;
    }
    finish();
    return deepFreeze({
      type: 'UpsertStatement',
      syntax: syntax,
      insert: baseInsert,
      conflict: { type: 'ConflictAction', target: target, action: action, assignments: assignments, where: updateWhere },
      returning: returning
    });
  }

  function parseMerge() {
    if (!word('MERGE')) return null;
    if (dialect !== 'postgresql') fail('MERGE is not valid for this Tier-1 source dialect');
    expectWord('MERGE'); expectWord('INTO', 'MERGE requires INTO');
    var target = identifier(false);
    var targetAlias = null;
    if (word('AS')) { take(); targetAlias = identifier(true); }
    expectWord('USING', 'MERGE requires USING');
    var source = identifier(false);
    var sourceAlias = null;
    if (word('AS')) { take(); sourceAlias = identifier(true); }
    expectWord('ON', 'MERGE requires ON');
    var onStart = p;
    var firstWhen = findTopWord(p, end, 'WHEN');
    if (firstWhen < 0) fail('MERGE requires at least one WHEN clause');
    var on = parseExpression(onStart, firstWhen);
    p = firstWhen;

    var matched = null;
    var notMatched = null;
    while (p < end) {
      expectWord('WHEN');
      if (word('MATCHED')) {
        if (matched) fail('dml-v2 supports one WHEN MATCHED clause');
        take(); expectWord('THEN', 'WHEN MATCHED requires THEN');
        if (word('DELETE')) { take(); matched = { type: 'MergeMatchedAction', action: 'delete', assignments: [] }; }
        else {
          expectWord('UPDATE', 'WHEN MATCHED supports UPDATE or DELETE');
          expectWord('SET', 'MERGE UPDATE requires SET');
          var nextWhen = findTopWord(p, end, 'WHEN');
          var matchedEnd = nextWhen >= 0 ? nextWhen : end;
          var parsedMatched = parseAssignments(p, matchedEnd, -1);
          matched = { type: 'MergeMatchedAction', action: 'update', assignments: parsedMatched.assignments };
          p = matchedEnd;
        }
      } else {
        expectWord('NOT', 'MERGE supports WHEN MATCHED or WHEN NOT MATCHED');
        expectWord('MATCHED'); expectWord('THEN', 'WHEN NOT MATCHED requires THEN'); expectWord('INSERT', 'WHEN NOT MATCHED requires INSERT');
        if (notMatched) fail('dml-v2 supports one WHEN NOT MATCHED clause');
        var columns = [];
        if (punctuation('(')) { take(); columns = identifierList(); expectPunctuation(')', 'Expected ) after MERGE INSERT columns'); }
        expectWord('VALUES', 'MERGE INSERT requires VALUES');
        expectPunctuation('(', 'MERGE INSERT VALUES requires (');
        var open = p - 1;
        var close = matchingParen(open, end);
        var values = parseValues(p, close);
        p = close + 1;
        if (columns.length && columns.length !== values.length) fail('MERGE INSERT column/value width mismatch', tokens[open]);
        notMatched = { type: 'MergeNotMatchedAction', columns: columns, values: values };
      }
    }
    if (!matched && !notMatched) fail('MERGE requires at least one action');
    finish();
    return deepFreeze({ type: 'MergeStatement', target: target, targetAlias: targetAlias, source: source, sourceAlias: sourceAlias, on: on, matched: matched, notMatched: notMatched });
  }

  return { parseUpsert: parseUpsert, parseMerge: parseMerge, firstWord: function (value) { return isWordToken(tokens[0], value); } };
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function quoteIdentifier(dialect, node) {
    if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError('DML semantic identifier is invalid');
    return node.parts.map(function (part) { return Compiler.quoteIdentifier(dialect, part); }).join('.');
  }
  function validateExpressionList(expressions, label) {
    if (!Array.isArray(expressions)) throw new TypeError(label + ' must be an array');
    if (expressions.length) baseApi.analyzeAst(fakeSelect(expressions));
  }
  function validateAssignmentList(assignments, label) {
    if (!Array.isArray(assignments) || assignments.length === 0) throw new TypeError(label + ' requires at least one assignment');
    var names = Object.create(null);
    assignments.forEach(function (assignment) {
      if (!assignment || assignment.type !== 'Assignment') throw new TypeError('Invalid ' + label + ' assignment');
      var name = identifierName(assignment.column);
      if (!name || assignment.column.parts.length !== 1) throw new TypeError(label + ' assignment target must be an unqualified identifier');
      if (names[name]) throw new RangeError('Duplicate ' + label + ' assignment column: ' + assignment.column.parts[0]);
      names[name] = true;
      validateExpressionList([assignment.value], label + ' assignment');
    });
  }
  function validateSemanticAst(ast) {
    if (!isSemanticAst(ast)) throw new TypeError('Expected UpsertStatement or MergeStatement');
    if (ast.type === 'UpsertStatement') {
      if (!ast.insert || ast.insert.type !== 'InsertStatement' || ast.insert.returning.length) throw new TypeError('UpsertStatement requires an INSERT core without RETURNING');
      baseApi.analyzeAst(ast.insert);
      if (!ast.conflict || ast.conflict.type !== 'ConflictAction') throw new TypeError('UpsertStatement requires a conflict action');
      if (ast.syntax !== 'on-conflict' && ast.syntax !== 'on-duplicate-key') throw new RangeError('Unsupported upsert syntax family');
      if (ast.conflict.action !== 'nothing' && ast.conflict.action !== 'update') throw new RangeError('Unsupported upsert conflict action');
      (ast.conflict.target || []).forEach(function (entry) { if (!identifierName(entry) || entry.parts.length !== 1) throw new TypeError('Conflict targets must be unqualified identifiers'); });
      if (ast.conflict.action === 'update') validateAssignmentList(ast.conflict.assignments, 'UPSERT');
      else if (ast.conflict.assignments.length) throw new TypeError('DO NOTHING cannot contain assignments');
      if (ast.conflict.where) validateExpressionList([ast.conflict.where], 'UPSERT WHERE');
      validateExpressionList(ast.returning, 'UPSERT RETURNING');
      return ast;
    }
    if (!identifierName(ast.target) || !identifierName(ast.source)) throw new TypeError('MERGE requires target and source relations');
    if (ast.targetAlias && ast.targetAlias.parts.length !== 1) throw new TypeError('MERGE target alias must be unqualified');
    if (ast.sourceAlias && ast.sourceAlias.parts.length !== 1) throw new TypeError('MERGE source alias must be unqualified');
    validateExpressionList([ast.on], 'MERGE ON');
    if (!ast.matched && !ast.notMatched) throw new TypeError('MERGE requires at least one action');
    if (ast.matched) {
      if (ast.matched.action !== 'update' && ast.matched.action !== 'delete') throw new RangeError('Unsupported WHEN MATCHED action');
      if (ast.matched.action === 'update') validateAssignmentList(ast.matched.assignments, 'MERGE UPDATE');
    }
    if (ast.notMatched) {
      if (!Array.isArray(ast.notMatched.columns) || !Array.isArray(ast.notMatched.values)) throw new TypeError('Invalid MERGE INSERT action');
      if (ast.notMatched.columns.length && ast.notMatched.columns.length !== ast.notMatched.values.length) throw new RangeError('MERGE INSERT column/value width mismatch');
      validateExpressionList(ast.notMatched.values, 'MERGE INSERT values');
    }
    return ast;
  }

  function add(set, path) { set[path] = true; }
  function addExpressionCapabilities(set, expressions) {
    if (!expressions || !expressions.length) return;
    baseApi.analyzeAst(fakeSelect(expressions)).capabilities.forEach(function (path) { if (path !== 'statements.select') add(set, path); });
  }
  function analyzeSemantic(ast) {
    validateSemanticAst(ast);
    var set = Object.create(null);
    if (ast.type === 'UpsertStatement') {
      add(set, 'statements.insert'); add(set, 'syntax.conflictHandling');
      baseApi.analyzeAst(ast.insert).capabilities.forEach(function (path) { add(set, path); });
      ast.conflict.assignments.forEach(function (assignment) { addExpressionCapabilities(set, [assignment.value]); });
      if (ast.conflict.where) addExpressionCapabilities(set, [ast.conflict.where]);
      if (ast.returning.length) { add(set, 'syntax.returning'); addExpressionCapabilities(set, ast.returning); }
    } else {
      add(set, 'statements.merge');
      addExpressionCapabilities(set, [ast.on]);
      if (ast.matched && ast.matched.action === 'update') ast.matched.assignments.forEach(function (assignment) { addExpressionCapabilities(set, [assignment.value]); });
      if (ast.notMatched) addExpressionCapabilities(set, ast.notMatched.values);
    }
    return deepFreeze({ statementType: ast.type, scope: 'dml-v2', capabilities: Object.keys(set).sort() });
  }

  function renumber(compiled, dialect, offset) {
    if (!compiled || !compiled.sql) throw new TypeError('Invalid compiled semantic fragment');
    if (dialect === 'mysql' || offset === 0) return compiled.sql;
    var tokens = Tokenizer.tokenize(compiled.sql, dialect);
    var out = '';
    var cursor = 0;
    tokens.forEach(function (token) {
      if (token.type !== 'parameter') return;
      out += compiled.sql.slice(cursor, token.start);
      if (typeof token.value !== 'number') throw new RangeError('Compiled semantic fragment requires positional target parameters');
      out += dialect === 'postgresql' ? '$' + (token.value + offset) : '?' + (token.value + offset);
      cursor = token.end;
    });
    return out + compiled.sql.slice(cursor);
  }
  function assembler(dialect) {
    var mapping = [];
    return {
      add: function (compiled, fragment) {
        var sql = renumber({ sql: fragment === undefined ? compiled.sql : fragment }, dialect, mapping.length);
        Array.prototype.push.apply(mapping, compiled.targetToSource || []);
        return sql;
      },
      result: function (sql) { return deepFreeze({ dialect: dialect, sql: sql, targetToSource: mapping.slice() }); }
    };
  }
  function updateFragment(dialect, assignments, where) {
    var fake = { type: 'UpdateStatement', target: { type: 'Identifier', parts: ['__nublox_semantic'] }, assignments: assignments, where: where || null, returning: [] };
    var compiled = baseApi.compileAst(dialect, fake);
    var prefix = 'UPDATE ' + Compiler.quoteIdentifier(dialect, '__nublox_semantic') + ' SET ';
    if (compiled.sql.slice(0, prefix.length) !== prefix) throw new Error('Unexpected semantic UPDATE compiler output');
    return { compiled: compiled, text: compiled.sql.slice(prefix.length) };
  }
  function expressionFragment(dialect, expression) {
    var fake = { type: 'DeleteStatement', target: { type: 'Identifier', parts: ['__nublox_semantic'] }, where: expression, returning: [] };
    var compiled = baseApi.compileAst(dialect, fake);
    var prefix = 'DELETE FROM ' + Compiler.quoteIdentifier(dialect, '__nublox_semantic') + ' WHERE ';
    return { compiled: compiled, text: compiled.sql.slice(prefix.length) };
  }
  function returningFragment(dialect, expressions) {
    var fake = { type: 'DeleteStatement', target: { type: 'Identifier', parts: ['__nublox_semantic'] }, where: null, returning: expressions };
    var compiled = baseApi.compileAst(dialect, fake);
    var marker = ' RETURNING ';
    var index = compiled.sql.indexOf(marker);
    if (index < 0) throw new Error('Unexpected semantic RETURNING compiler output');
    return { compiled: compiled, text: compiled.sql.slice(index + marker.length) };
  }
  function mergeInsertFragment(dialect, action) {
    var fake = { type: 'InsertStatement', target: { type: 'Identifier', parts: ['__nublox_semantic'] }, columns: action.columns, rows: [action.values], source: null, returning: [] };
    var compiled = baseApi.compileAst(dialect, fake);
    var prefix = 'INSERT INTO ' + Compiler.quoteIdentifier(dialect, '__nublox_semantic');
    if (compiled.sql.slice(0, prefix.length) !== prefix) throw new Error('Unexpected semantic INSERT compiler output');
    return { compiled: compiled, text: compiled.sql.slice(prefix.length) };
  }

  function ensureSemanticCompatibility(ast, source, target) {
    if (ast.type === 'MergeStatement') {
      if (source !== 'postgresql') throw new SyntaxError('MERGE is only accepted as PostgreSQL source syntax in dml-v2');
      if (target !== 'postgresql') throw new RangeError('MERGE has no certified automatic rewrite to ' + target);
      return;
    }
    var sourceFamily = ast.syntax;
    var targetFamily = target === 'mysql' ? 'on-duplicate-key' : 'on-conflict';
    if (sourceFamily !== targetFamily) throw new RangeError('UPSERT conflict semantics are not losslessly portable between ' + source + ' and ' + target);
    if (ast.returning.length && target === 'mysql') throw new RangeError('MySQL cannot represent UPSERT RETURNING');
  }

  function compileSemantic(dialect, ast) {
    validateSemanticAst(ast);
    var target = normalizeDialect(dialect);
    var out = assembler(target);
    var sql;
    if (ast.type === 'UpsertStatement') {
      var targetFamily = target === 'mysql' ? 'on-duplicate-key' : 'on-conflict';
      if (ast.syntax !== targetFamily) throw new RangeError('UPSERT AST semantic family cannot be rendered losslessly for ' + target);
      var insertCompiled = baseApi.compileAst(target, ast.insert);
      sql = out.add(insertCompiled);
      if (target === 'mysql') {
        if (ast.conflict.action !== 'update') throw new RangeError('MySQL ON DUPLICATE KEY UPDATE has no DO NOTHING form in dml-v2');
        var duplicate = updateFragment(target, ast.conflict.assignments, null);
        sql += ' ON DUPLICATE KEY UPDATE ' + out.add(duplicate.compiled, duplicate.text);
      } else {
        sql += ' ON CONFLICT';
        if (ast.conflict.target.length) sql += ' (' + ast.conflict.target.map(function (entry) { return quoteIdentifier(target, entry); }).join(', ') + ')';
        if (ast.conflict.action === 'nothing') sql += ' DO NOTHING';
        else {
          var conflictUpdate = updateFragment(target, ast.conflict.assignments, ast.conflict.where);
          sql += ' DO UPDATE SET ' + out.add(conflictUpdate.compiled, conflictUpdate.text);
        }
      }
      if (ast.returning.length) {
        var returning = returningFragment(target, ast.returning);
        sql += ' RETURNING ' + out.add(returning.compiled, returning.text);
      }
      return out.result(sql);
    }

    if (target !== 'postgresql') throw new RangeError('dml-v2 MERGE renderer is currently PostgreSQL-only');
    sql = 'MERGE INTO ' + quoteIdentifier(target, ast.target);
    if (ast.targetAlias) sql += ' AS ' + quoteIdentifier(target, ast.targetAlias);
    sql += ' USING ' + quoteIdentifier(target, ast.source);
    if (ast.sourceAlias) sql += ' AS ' + quoteIdentifier(target, ast.sourceAlias);
    var on = expressionFragment(target, ast.on);
    sql += ' ON ' + out.add(on.compiled, on.text);
    if (ast.matched) {
      sql += ' WHEN MATCHED THEN ';
      if (ast.matched.action === 'delete') sql += 'DELETE';
      else {
        var matchedUpdate = updateFragment(target, ast.matched.assignments, null);
        sql += 'UPDATE SET ' + out.add(matchedUpdate.compiled, matchedUpdate.text);
      }
    }
    if (ast.notMatched) {
      var insert = mergeInsertFragment(target, ast.notMatched);
      sql += ' WHEN NOT MATCHED THEN INSERT' + out.add(insert.compiled, insert.text);
    }
    return out.result(sql);
  }

  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var parser = createParser(sql, source, baseApi);
    var ast = parser.firstWord('MERGE') ? parser.parseMerge() : parser.parseUpsert();
    return ast || baseApi.parseSql(source, sql);
  }
  function analyzeAst(ast) { return isSemanticAst(ast) ? analyzeSemantic(ast) : baseApi.analyzeAst(ast); }
  function compileAst(dialect, ast) { return isSemanticAst(ast) ? compileSemantic(dialect, ast) : baseApi.compileAst(dialect, ast); }
  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from);
    var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    if (!isSemanticAst(ast)) return baseApi.transpileSql(source, target, sql, options);
    ensureSemanticCompatibility(ast, source, target);
    var analysis = analyzeSemantic(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL AST transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL AST transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    var compiled = compileSemantic(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: analysis.scope, ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: compiled.targetToSource, lossless: lossless, certified: plan.safeToProceed && lossless });
  }

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isSemanticAst = isSemanticAst;

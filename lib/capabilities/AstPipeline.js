'use strict';

var Parser = require('./Parser');
var Compiler = require('./Compiler');

var QUERY_WAVE1_CAPABILITIES = Object.freeze({
  'queries.cte.ordinary': true,
  'queries.cte.recursive': true,
  'queries.subqueries.scalar': true,
  'queries.subqueries.correlated': true,
  'queries.subqueries.exists': true,
  'queries.subqueries.in': true,
  'queries.subqueries.derivedTables': true
});

function identifierName(node) {
  if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) return null;
  return String(node.parts[node.parts.length - 1]).toLowerCase();
}

function add(set, path) { set[path] = true; }
function namesUnion(left, right) {
  var result = Object.create(null);
  Object.keys(left || {}).forEach(function (name) { result[name] = true; });
  Object.keys(right || {}).forEach(function (name) { result[name] = true; });
  return result;
}

function relationName(node) {
  if (!node) return null;
  if (node.alias) return identifierName(node.alias);
  if (node.type === 'TableReference') return identifierName(node.name);
  return null;
}

function localRelationNames(query) {
  var result = Object.create(null);
  function include(node) {
    var name = relationName(node);
    if (name) result[name] = true;
  }
  include(query.from);
  (query.joins || []).forEach(function (entry) { include(entry.source); });
  return result;
}

function walkExpression(node, visitQuery, visitIdentifier, context) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier') { if (visitIdentifier) visitIdentifier(node); return; }
  if (node.type === 'Wildcard') { if (node.qualifier && visitIdentifier) visitIdentifier(node.qualifier); return; }
  if (node.type === 'AliasedExpression') { walkExpression(node.expression, visitQuery, visitIdentifier, context); return; }
  if (node.type === 'UnaryExpression') { walkExpression(node.argument, visitQuery, visitIdentifier, context); return; }
  if (node.type === 'BinaryExpression') {
    walkExpression(node.left, visitQuery, visitIdentifier, context);
    if (node.operator === 'IN' && node.right && node.right.type === 'SubqueryExpression') visitQuery(node.right.query, 'in');
    else walkExpression(node.right, visitQuery, visitIdentifier, context);
    return;
  }
  if (node.type === 'ListExpression') { node.items.forEach(function (item) { walkExpression(item, visitQuery, visitIdentifier, context); }); return; }
  if (node.type === 'CallExpression') { node.arguments.forEach(function (item) { walkExpression(item, visitQuery, visitIdentifier, context); }); return; }
  if (node.type === 'SubqueryExpression') { visitQuery(node.query, context || 'scalar'); return; }
  if (node.type === 'ExistsExpression') { visitQuery(node.query, 'exists'); }
}

function walkQueryExpressions(query, visitQuery, visitIdentifier) {
  (query.columns || []).forEach(function (entry) { walkExpression(entry, visitQuery, visitIdentifier, 'scalar'); });
  walkExpression(query.where, visitQuery, visitIdentifier, 'scalar');
  (query.groupBy || []).forEach(function (entry) { walkExpression(entry, visitQuery, visitIdentifier, 'scalar'); });
  walkExpression(query.having, visitQuery, visitIdentifier, 'scalar');
  (query.orderBy || []).forEach(function (entry) { walkExpression(entry.expression, visitQuery, visitIdentifier, 'scalar'); });
  walkExpression(query.limit, visitQuery, visitIdentifier, 'scalar');
  walkExpression(query.offset, visitQuery, visitIdentifier, 'scalar');
  (query.joins || []).forEach(function (entry) { walkExpression(entry.condition, visitQuery, visitIdentifier, 'scalar'); });
}

function collectRelationReferences(query, out) {
  out = out || Object.create(null);
  function relation(node) {
    if (!node) return;
    if (node.type === 'TableReference') {
      var name = identifierName(node.name);
      if (name) out[name] = true;
      return;
    }
    if (node.type === 'DerivedTable') collectRelationReferences(node.query, out);
  }
  relation(query.from);
  (query.joins || []).forEach(function (entry) { relation(entry.source); });
  if (query.with) query.with.entries.forEach(function (entry) { collectRelationReferences(entry.query, out); });
  walkQueryExpressions(query, function (nested) { collectRelationReferences(nested, out); });
  return out;
}

function validateIdentifier(node, label, simple) {
  if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
  if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be an unqualified identifier');
}

function validateExpression(node) {
  if (!node) return;
  if (typeof node !== 'object' || typeof node.type !== 'string') throw new TypeError('Invalid SQL AST expression');
  walkExpression(node, function (nested) { validateQuery(nested); }, function (identifier) { validateIdentifier(identifier, 'SQL expression identifier', false); });
}

function validateRelation(node) {
  if (!node) return;
  if (node.type === 'TableReference') {
    validateIdentifier(node.name, 'Table reference', false);
    if (node.alias) validateIdentifier(node.alias, 'Table alias', true);
    return;
  }
  if (node.type === 'DerivedTable') {
    validateIdentifier(node.alias, 'Derived-table alias', true);
    (node.columns || []).forEach(function (column) { validateIdentifier(column, 'Derived-table column alias', true); });
    validateQuery(node.query);
    return;
  }
  throw new TypeError('Unsupported SQL AST relation node: ' + node.type);
}

function validateWith(withNode) {
  if (!withNode) return;
  if (withNode.type !== 'WithClause' || !Array.isArray(withNode.entries) || withNode.entries.length === 0) throw new TypeError('WITH clause requires at least one common table expression');
  var names = [];
  var indexByName = Object.create(null);
  withNode.entries.forEach(function (entry, index) {
    if (!entry || entry.type !== 'CommonTableExpression') throw new TypeError('Invalid common table expression');
    validateIdentifier(entry.name, 'CTE name', true);
    var name = identifierName(entry.name);
    if (Object.prototype.hasOwnProperty.call(indexByName, name)) throw new RangeError('Duplicate CTE name: ' + entry.name.parts[0]);
    indexByName[name] = index;
    names.push(name);
    var columns = Object.create(null);
    (entry.columns || []).forEach(function (column) {
      validateIdentifier(column, 'CTE column name', true);
      var columnName = identifierName(column);
      if (columns[columnName]) throw new RangeError('Duplicate CTE column name: ' + column.parts[0]);
      columns[columnName] = true;
    });
  });
  withNode.entries.forEach(function (entry, index) {
    var references = collectRelationReferences(entry.query);
    names.forEach(function (name, targetIndex) {
      if (!references[name]) return;
      if (targetIndex > index) throw new RangeError('CTE ' + entry.name.parts[0] + ' cannot reference later CTE ' + withNode.entries[targetIndex].name.parts[0]);
      if (targetIndex === index && !withNode.recursive) throw new RangeError('CTE ' + entry.name.parts[0] + ' requires WITH RECURSIVE for self-reference');
    });
    validateQuery(entry.query);
  });
}

function validateQuery(query) {
  if (!query || query.type !== 'SelectStatement') throw new TypeError('NuBloxSQL query AST requires SelectStatement');
  if (!Array.isArray(query.columns) || query.columns.length === 0) throw new TypeError('SELECT requires at least one result expression');
  validateWith(query.with);
  query.columns.forEach(validateExpression);
  validateRelation(query.from);
  (query.joins || []).forEach(function (entry) {
    if (!entry || entry.type !== 'Join') throw new TypeError('Invalid SQL AST join');
    validateRelation(entry.source);
    validateExpression(entry.condition);
  });
  validateExpression(query.where);
  (query.groupBy || []).forEach(validateExpression);
  validateExpression(query.having);
  (query.orderBy || []).forEach(function (entry) { validateExpression(entry.expression); });
  validateExpression(query.limit);
  validateExpression(query.offset);
  return query;
}

function collectCapabilities(ast) {
  validateQuery(ast);
  var paths = Object.create(null);

  function visitQuery(query, outerNames, subqueryKind) {
    add(paths, 'statements.select');
    if (subqueryKind) {
      if (subqueryKind === 'exists') add(paths, 'queries.subqueries.exists');
      else if (subqueryKind === 'in') add(paths, 'queries.subqueries.in');
      else add(paths, 'queries.subqueries.scalar');
    }
    if (query.with) {
      add(paths, 'queries.cte.ordinary');
      if (query.with.recursive) add(paths, 'queries.cte.recursive');
      query.with.entries.forEach(function (entry) { visitQuery(entry.query, outerNames, null); });
    }
    if (query.distinct) add(paths, 'queries.distinct.standard');
    (query.joins || []).forEach(function (entry) { add(paths, 'queries.joins.' + entry.kind.toLowerCase()); });
    if (query.groupBy.length) add(paths, 'queries.grouping.groupBy');
    if (query.having) add(paths, 'queries.grouping.having');
    if (query.orderBy.length) add(paths, 'queries.ordering.orderBy');
    if (query.limit) add(paths, 'queries.pagination.limit');
    if (query.offset) add(paths, 'queries.pagination.offset');

    var localNames = localRelationNames(query);
    var visibleOuter = namesUnion(outerNames, localNames);
    function identifierVisit(identifier) {
      if (!outerNames || identifier.parts.length < 2) return;
      var qualifier = String(identifier.parts[0]).toLowerCase();
      if (outerNames[qualifier] && !localNames[qualifier]) add(paths, 'queries.subqueries.correlated');
    }
    function nestedVisit(nested, kind) { visitQuery(nested, visibleOuter, kind); }
    walkQueryExpressions(query, nestedVisit, identifierVisit);

    function relationVisit(node) {
      if (!node) return;
      if (node.type === 'DerivedTable') {
        add(paths, 'queries.subqueries.derivedTables');
        visitQuery(node.query, Object.create(null), null);
      }
    }
    relationVisit(query.from);
    query.joins.forEach(function (entry) { relationVisit(entry.source); });
  }

  visitQuery(ast, Object.create(null), null);
  return Object.freeze(Object.keys(paths).sort());
}

function scopeForCapabilities(capabilities) {
  for (var i = 0; i < capabilities.length; i += 1) if (QUERY_WAVE1_CAPABILITIES[capabilities[i]]) return 'select-query-v2';
  return 'select-foundation-v1';
}

function create(core, normalizeDialect, rewriteApi) {
  function parseSql(dialect, sql) {
    var ast = Parser.parse(sql, normalizeDialect(dialect), core);
    validateQuery(ast);
    return ast;
  }

  function analyzeAst(ast) {
    var capabilities = collectCapabilities(ast);
    return core.deepFreeze({ statementType: ast.type, scope: scopeForCapabilities(capabilities), capabilities: capabilities });
  }

  function compileAst(dialect, ast) {
    validateQuery(ast);
    var target = normalizeDialect(dialect);
    var compiled = Compiler.compile(ast, target);
    return core.deepFreeze({ dialect: target, sql: compiled.sql, targetToSource: compiled.targetToSource });
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
    return core.deepFreeze({
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

  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.collectCapabilities = collectCapabilities;
exports.validateQuery = validateQuery;
exports.scopeForCapabilities = scopeForCapabilities;

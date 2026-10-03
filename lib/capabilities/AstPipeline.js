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
var QUERY_WAVE2_CAPABILITIES = Object.freeze({
  'queries.setOperators.union': true,
  'queries.setOperators.unionAll': true,
  'queries.setOperators.intersect': true,
  'queries.setOperators.intersectAll': true,
  'queries.setOperators.except': true,
  'queries.setOperators.exceptAll': true
});
var QUERY_WAVE3_CAPABILITIES = Object.freeze({
  'expressions.caseExpression': true,
  'expressions.cast': true,
  'queries.windows.supported': true,
  'queries.windows.named': true,
  'queries.windows.rows': true,
  'queries.windows.range': true,
  'queries.windows.groups': true,
  'queries.windows.exclude': true
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
  if (!query || query.type !== 'SelectStatement') return result;
  function include(node) {
    var name = relationName(node);
    if (name) result[name] = true;
  }
  include(query.from);
  (query.joins || []).forEach(function (entry) { include(entry.source); });
  return result;
}

function walkWindowSpecification(node, visitQuery, visitIdentifier, context, visitNode) {
  if (!node || node.type !== 'WindowSpecification') return;
  if (node.base && visitIdentifier) visitIdentifier(node.base);
  (node.partitionBy || []).forEach(function (item) { walkExpression(item, visitQuery, visitIdentifier, context, visitNode); });
  (node.orderBy || []).forEach(function (entry) { walkExpression(entry.expression, visitQuery, visitIdentifier, context, visitNode); });
  if (node.frame) {
    if (node.frame.start && node.frame.start.value) walkExpression(node.frame.start.value, visitQuery, visitIdentifier, context, visitNode);
    if (node.frame.end && node.frame.end.value) walkExpression(node.frame.end.value, visitQuery, visitIdentifier, context, visitNode);
  }
}

function walkExpression(node, visitQuery, visitIdentifier, context, visitNode) {
  if (!node || typeof node !== 'object') return;
  if (visitNode) visitNode(node);
  if (node.type === 'Identifier') { if (visitIdentifier) visitIdentifier(node); return; }
  if (node.type === 'Wildcard') { if (node.qualifier && visitIdentifier) visitIdentifier(node.qualifier); return; }
  if (node.type === 'AliasedExpression') { walkExpression(node.expression, visitQuery, visitIdentifier, context, visitNode); return; }
  if (node.type === 'UnaryExpression') { walkExpression(node.argument, visitQuery, visitIdentifier, context, visitNode); return; }
  if (node.type === 'BinaryExpression') {
    walkExpression(node.left, visitQuery, visitIdentifier, context, visitNode);
    if ((node.operator === 'IN' || node.operator === 'NOT IN') && node.right && node.right.type === 'SubqueryExpression') visitQuery(node.right.query, 'in');
    else walkExpression(node.right, visitQuery, visitIdentifier, context, visitNode);
    return;
  }
  if (node.type === 'BetweenExpression') {
    walkExpression(node.expression, visitQuery, visitIdentifier, context, visitNode);
    walkExpression(node.lower, visitQuery, visitIdentifier, context, visitNode);
    walkExpression(node.upper, visitQuery, visitIdentifier, context, visitNode);
    return;
  }
  if (node.type === 'ListExpression') { node.items.forEach(function (item) { walkExpression(item, visitQuery, visitIdentifier, context, visitNode); }); return; }
  if (node.type === 'CallExpression') { node.arguments.forEach(function (item) { walkExpression(item, visitQuery, visitIdentifier, context, visitNode); }); return; }
  if (node.type === 'CastExpression') { walkExpression(node.expression, visitQuery, visitIdentifier, context, visitNode); return; }
  if (node.type === 'CaseExpression') {
    walkExpression(node.operand, visitQuery, visitIdentifier, context, visitNode);
    node.branches.forEach(function (branch) {
      walkExpression(branch.when, visitQuery, visitIdentifier, context, visitNode);
      walkExpression(branch.then, visitQuery, visitIdentifier, context, visitNode);
    });
    walkExpression(node.else, visitQuery, visitIdentifier, context, visitNode);
    return;
  }
  if (node.type === 'WindowExpression') {
    walkExpression(node.expression, visitQuery, visitIdentifier, context, visitNode);
    if (node.over && node.over.type === 'WindowReference') {
      if (visitIdentifier) visitIdentifier(node.over.name);
    } else walkWindowSpecification(node.over, visitQuery, visitIdentifier, context, visitNode);
    return;
  }
  if (node.type === 'SubqueryExpression') { visitQuery(node.query, context || 'scalar'); return; }
  if (node.type === 'ExistsExpression') { visitQuery(node.query, 'exists'); }
}

function walkQueryExpressions(query, visitQuery, visitIdentifier, visitNode) {
  if (!query) return;
  if (query.type === 'SetOperationStatement') {
    (query.orderBy || []).forEach(function (entry) { walkExpression(entry.expression, visitQuery, visitIdentifier, 'scalar', visitNode); });
    walkExpression(query.limit, visitQuery, visitIdentifier, 'scalar', visitNode);
    walkExpression(query.offset, visitQuery, visitIdentifier, 'scalar', visitNode);
    return;
  }
  (query.columns || []).forEach(function (entry) { walkExpression(entry, visitQuery, visitIdentifier, 'scalar', visitNode); });
  walkExpression(query.where, visitQuery, visitIdentifier, 'scalar', visitNode);
  (query.groupBy || []).forEach(function (entry) { walkExpression(entry, visitQuery, visitIdentifier, 'scalar', visitNode); });
  walkExpression(query.having, visitQuery, visitIdentifier, 'scalar', visitNode);
  (query.windows || []).forEach(function (entry) { walkWindowSpecification(entry.specification, visitQuery, visitIdentifier, 'scalar', visitNode); });
  (query.orderBy || []).forEach(function (entry) { walkExpression(entry.expression, visitQuery, visitIdentifier, 'scalar', visitNode); });
  walkExpression(query.limit, visitQuery, visitIdentifier, 'scalar', visitNode);
  walkExpression(query.offset, visitQuery, visitIdentifier, 'scalar', visitNode);
  (query.joins || []).forEach(function (entry) { walkExpression(entry.condition, visitQuery, visitIdentifier, 'scalar', visitNode); });
}

function collectRelationReferences(query, out) {
  out = out || Object.create(null);
  if (!query) return out;
  if (query.with) query.with.entries.forEach(function (entry) { collectRelationReferences(entry.query, out); });
  if (query.type === 'SetOperationStatement') {
    collectRelationReferences(query.left, out);
    collectRelationReferences(query.right, out);
    walkQueryExpressions(query, function (nested) { collectRelationReferences(nested, out); });
    return out;
  }
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
  walkQueryExpressions(query, function (nested) { collectRelationReferences(nested, out); });
  return out;
}

function validateIdentifier(node, label, simple) {
  if (!node || node.type !== 'Identifier' || !Array.isArray(node.parts) || node.parts.length === 0) throw new TypeError(label + ' must be an Identifier');
  if (simple && node.parts.length !== 1) throw new TypeError(label + ' must be an unqualified identifier');
}

function validateTypeName(node) {
  if (!node || node.type !== 'TypeName' || typeof node.name !== 'string' || !/^[A-Z][A-Z0-9_ ]*$/.test(node.name)) throw new TypeError('Invalid SQL AST type name');
  if (!Array.isArray(node.modifiers)) throw new TypeError('SQL AST type modifiers must be an array');
  node.modifiers.forEach(function (modifier) {
    if (!Number.isSafeInteger(modifier) || modifier < 0) throw new RangeError('SQL AST type modifier must be a non-negative safe integer');
  });
}

function validateWindowFrameBound(node, label) {
  if (!node || node.type !== 'WindowFrameBound') throw new TypeError(label + ' must be a WindowFrameBound');
  if (['UNBOUNDED PRECEDING', 'UNBOUNDED FOLLOWING', 'CURRENT ROW', 'VALUE PRECEDING', 'VALUE FOLLOWING'].indexOf(node.kind) === -1) throw new RangeError('Unsupported SQL window frame bound: ' + node.kind);
  if (node.kind.indexOf('VALUE ') === 0) validateExpression(node.value);
  else if (node.value) throw new TypeError('Non-offset window frame bound cannot have a value');
}

function validateWindowSpecification(node) {
  if (!node || node.type !== 'WindowSpecification') throw new TypeError('Invalid SQL AST window specification');
  if (node.base) validateIdentifier(node.base, 'Base window name', true);
  (node.partitionBy || []).forEach(validateExpression);
  (node.orderBy || []).forEach(function (entry) {
    if (!entry || entry.type !== 'OrderExpression') throw new TypeError('Invalid SQL AST window ORDER BY expression');
    if (entry.direction && entry.direction !== 'ASC' && entry.direction !== 'DESC') throw new RangeError('Unsupported SQL ORDER BY direction: ' + entry.direction);
    validateExpression(entry.expression);
  });
  if (node.frame) {
    if (node.frame.type !== 'WindowFrame' || ['ROWS', 'RANGE', 'GROUPS'].indexOf(node.frame.unit) === -1) throw new TypeError('Invalid SQL AST window frame');
    validateWindowFrameBound(node.frame.start, 'Window frame start');
    if (node.frame.end) validateWindowFrameBound(node.frame.end, 'Window frame end');
    if (node.frame.start.kind === 'UNBOUNDED FOLLOWING') throw new RangeError('Window frame cannot start with UNBOUNDED FOLLOWING');
    if (node.frame.end && node.frame.end.kind === 'UNBOUNDED PRECEDING') throw new RangeError('Window frame cannot end with UNBOUNDED PRECEDING');
    if (node.frame.exclude && ['CURRENT ROW', 'GROUP', 'TIES', 'NO OTHERS'].indexOf(node.frame.exclude) === -1) throw new RangeError('Unsupported SQL window EXCLUDE mode: ' + node.frame.exclude);
  }
}

function validateExpressionNode(node) {
  if (node.type === 'CastExpression') validateTypeName(node.targetType);
  if (node.type === 'CaseExpression') {
    if (!Array.isArray(node.branches) || node.branches.length === 0) throw new TypeError('CASE expression requires at least one branch');
    node.branches.forEach(function (branch) {
      if (!branch || branch.type !== 'CaseBranch' || !branch.when || !branch.then) throw new TypeError('Invalid SQL AST CASE branch');
    });
  }
  if (node.type === 'BetweenExpression') {
    if (!node.expression || !node.lower || !node.upper || typeof node.not !== 'boolean') throw new TypeError('Invalid SQL AST BETWEEN expression');
  }
  if (node.type === 'WindowExpression') {
    if (!node.expression || node.expression.type !== 'CallExpression') throw new TypeError('SQL window expression requires a function call');
    if (!node.over) throw new TypeError('SQL window expression requires OVER');
    if (node.over.type === 'WindowReference') validateIdentifier(node.over.name, 'Window reference', true);
    else validateWindowSpecification(node.over);
  }
}

function validateExpression(node) {
  if (!node) return;
  if (typeof node !== 'object' || typeof node.type !== 'string') throw new TypeError('Invalid SQL AST expression');
  walkExpression(node, function (nested) { validateQuery(nested); }, function (identifier) { validateIdentifier(identifier, 'SQL expression identifier', false); }, null, validateExpressionNode);
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

function validateWindows(query) {
  var definitions = query.windows || [];
  if (!Array.isArray(definitions)) throw new TypeError('SELECT windows must be an array');
  var names = Object.create(null);
  definitions.forEach(function (entry) {
    if (!entry || entry.type !== 'WindowDefinition') throw new TypeError('Invalid SQL AST WINDOW definition');
    validateIdentifier(entry.name, 'Window name', true);
    var name = identifierName(entry.name);
    if (names[name]) throw new RangeError('Duplicate WINDOW name: ' + entry.name.parts[0]);
    names[name] = true;
    validateWindowSpecification(entry.specification);
  });
  definitions.forEach(function (entry) {
    if (entry.specification.base) {
      var base = identifierName(entry.specification.base);
      if (!names[base]) throw new RangeError('Unknown base WINDOW name: ' + entry.specification.base.parts[0]);
      if (base === identifierName(entry.name)) throw new RangeError('WINDOW definition cannot reference itself: ' + entry.name.parts[0]);
    }
  });
  walkQueryExpressions(query, function () {}, null, function (node) {
    if (node.type === 'WindowExpression' && node.over.type === 'WindowReference') {
      var referenced = identifierName(node.over.name);
      if (!names[referenced]) throw new RangeError('Unknown WINDOW reference: ' + node.over.name.parts[0]);
    }
    if (node.type === 'WindowExpression' && node.over.type === 'WindowSpecification' && node.over.base) {
      var base = identifierName(node.over.base);
      if (!names[base]) throw new RangeError('Unknown base WINDOW reference: ' + node.over.base.parts[0]);
    }
  });
}

function validateTail(query) {
  (query.orderBy || []).forEach(function (entry) {
    if (!entry || entry.type !== 'OrderExpression') throw new TypeError('Invalid SQL AST ORDER BY expression');
    if (entry.direction && entry.direction !== 'ASC' && entry.direction !== 'DESC') throw new RangeError('Unsupported SQL ORDER BY direction: ' + entry.direction);
    validateExpression(entry.expression);
  });
  validateExpression(query.limit);
  validateExpression(query.offset);
}

function validateQuery(query) {
  if (!query || typeof query !== 'object') throw new TypeError('NuBloxSQL query AST requires a query object');
  if (query.type === 'SetOperationStatement') {
    if (['UNION', 'INTERSECT', 'EXCEPT'].indexOf(query.operator) === -1) throw new RangeError('Unsupported SQL set operator: ' + query.operator);
    if (typeof query.all !== 'boolean') throw new TypeError('SQL set-operation all flag must be boolean');
    validateWith(query.with);
    validateQuery(query.left);
    validateQuery(query.right);
    validateTail(query);
    return query;
  }
  if (query.type !== 'SelectStatement') throw new TypeError('NuBloxSQL query AST requires SelectStatement or SetOperationStatement');
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
  validateWindows(query);
  validateTail(query);
  return query;
}

function setCapability(query) {
  var suffix = query.operator.toLowerCase();
  if (query.all) suffix += 'All';
  return 'queries.setOperators.' + suffix;
}

function collectCapabilities(ast) {
  validateQuery(ast);
  var paths = Object.create(null);

  function expressionCapability(node) {
    if (node.type === 'CaseExpression') add(paths, 'expressions.caseExpression');
    else if (node.type === 'CastExpression') add(paths, 'expressions.cast');
    else if (node.type === 'BetweenExpression') add(paths, 'expressions.comparison');
    else if (node.type === 'BinaryExpression' && (node.operator === 'LIKE' || node.operator === 'NOT LIKE')) add(paths, 'expressions.like');
    else if (node.type === 'WindowExpression') {
      add(paths, 'queries.windows.supported');
      if (node.over.type === 'WindowReference') add(paths, 'queries.windows.named');
      else if (node.over.type === 'WindowSpecification') {
        if (node.over.base) add(paths, 'queries.windows.named');
        if (node.over.frame) {
          add(paths, 'queries.windows.' + node.over.frame.unit.toLowerCase());
          if (node.over.frame.exclude) add(paths, 'queries.windows.exclude');
        }
      }
    }
  }

  function visitWith(query, outerNames) {
    if (!query.with) return;
    add(paths, 'queries.cte.ordinary');
    if (query.with.recursive) add(paths, 'queries.cte.recursive');
    query.with.entries.forEach(function (entry) { visitQuery(entry.query, outerNames, null); });
  }

  function visitTail(query, outerNames, localNames) {
    if (query.orderBy && query.orderBy.length) add(paths, 'queries.ordering.orderBy');
    if (query.limit) add(paths, 'queries.pagination.limit');
    if (query.offset) add(paths, 'queries.pagination.offset');
    if (query.windows && query.windows.length) add(paths, 'queries.windows.named');
    var visibleOuter = namesUnion(outerNames, localNames || Object.create(null));
    function identifierVisit(identifier) {
      if (!outerNames || identifier.parts.length < 2) return;
      var qualifier = String(identifier.parts[0]).toLowerCase();
      if (outerNames[qualifier] && !(localNames && localNames[qualifier])) add(paths, 'queries.subqueries.correlated');
    }
    function nestedVisit(nested, kind) { visitQuery(nested, visibleOuter, kind); }
    walkQueryExpressions(query, nestedVisit, identifierVisit, expressionCapability);
  }

  function visitQuery(query, outerNames, subqueryKind) {
    if (subqueryKind) {
      if (subqueryKind === 'exists') add(paths, 'queries.subqueries.exists');
      else if (subqueryKind === 'in') add(paths, 'queries.subqueries.in');
      else add(paths, 'queries.subqueries.scalar');
    }
    visitWith(query, outerNames);

    if (query.type === 'SetOperationStatement') {
      add(paths, setCapability(query));
      visitQuery(query.left, outerNames, null);
      visitQuery(query.right, outerNames, null);
      visitTail(query, outerNames, Object.create(null));
      return;
    }

    add(paths, 'statements.select');
    if (query.distinct) add(paths, 'queries.distinct.standard');
    (query.joins || []).forEach(function (entry) { add(paths, 'queries.joins.' + entry.kind.toLowerCase()); });
    if (query.groupBy.length) add(paths, 'queries.grouping.groupBy');
    if (query.having) add(paths, 'queries.grouping.having');

    var localNames = localRelationNames(query);
    visitTail(query, outerNames, localNames);

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
  var i;
  for (i = 0; i < capabilities.length; i += 1) if (QUERY_WAVE3_CAPABILITIES[capabilities[i]]) return 'select-query-v4';
  for (i = 0; i < capabilities.length; i += 1) if (QUERY_WAVE2_CAPABILITIES[capabilities[i]]) return 'select-query-v3';
  for (i = 0; i < capabilities.length; i += 1) if (QUERY_WAVE1_CAPABILITIES[capabilities[i]]) return 'select-query-v2';
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

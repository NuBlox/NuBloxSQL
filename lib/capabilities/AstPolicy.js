'use strict';

var AstPipeline = require('./AstPipeline');

var FRAME_BOUND_RANK = Object.freeze({
  'UNBOUNDED PRECEDING': 0,
  'VALUE PRECEDING': 1,
  'CURRENT ROW': 2,
  'VALUE FOLLOWING': 3,
  'UNBOUNDED FOLLOWING': 4
});

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach(function (entry) { walk(entry, visitor); });
    return;
  }
  Object.keys(value).forEach(function (key) { walk(value[key], visitor); });
}

function validateSourceSyntax(source, ast) {
  walk(ast, function (node) {
    if (node.type === 'CastExpression' && node.syntax === '::' && source !== 'postgresql') {
      throw new SyntaxError('PostgreSQL :: cast syntax is not valid for ' + source + ' source SQL');
    }
  });
}

function validateWindowFrames(ast) {
  walk(ast, function (node) {
    if (node.type !== 'WindowFrame') return;
    var startRank = node.start && FRAME_BOUND_RANK[node.start.kind];
    var endKind = node.end ? node.end.kind : 'CURRENT ROW';
    var endRank = FRAME_BOUND_RANK[endKind];
    if (startRank === undefined || endRank === undefined) throw new RangeError('Unsupported SQL window frame boundary');
    if (endRank < startRank) throw new RangeError('Window frame end cannot precede its start');
  });
}

function add(set, path) { set[path] = true; }

function addWindowSpecificationCapabilities(specification, set) {
  if (!specification || specification.type !== 'WindowSpecification') return;
  add(set, 'queries.windows.supported');
  if (specification.base) add(set, 'queries.windows.named');
  if (specification.frame) {
    add(set, 'queries.windows.' + String(specification.frame.unit).toLowerCase());
    if (specification.frame.exclude) add(set, 'queries.windows.exclude');
  }
}

function augmentCapabilities(ast, baseCapabilities) {
  var set = Object.create(null);
  (baseCapabilities || []).forEach(function (path) { add(set, path); });
  walk(ast, function (node) {
    if (node.type === 'WindowDefinition') {
      add(set, 'queries.windows.supported');
      add(set, 'queries.windows.named');
      addWindowSpecificationCapabilities(node.specification, set);
    } else if (node.type === 'WindowSpecification') {
      addWindowSpecificationCapabilities(node, set);
    }
  });
  return Object.freeze(Object.keys(set).sort());
}

function validatePolicy(ast) {
  validateWindowFrames(ast);
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var ast = baseApi.parseSql(source, sql);
    validateSourceSyntax(source, ast);
    validatePolicy(ast);
    return ast;
  }

  function analyzeAst(ast) {
    validatePolicy(ast);
    var base = baseApi.analyzeAst(ast);
    var capabilities = augmentCapabilities(ast, base.capabilities);
    return Object.freeze({
      statementType: base.statementType,
      scope: AstPipeline.scopeForCapabilities(capabilities),
      capabilities: capabilities
    });
  }

  function compileAst(dialect, ast) {
    validatePolicy(ast);
    return baseApi.compileAst(dialect, ast);
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
    return Object.freeze({
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
exports.augmentCapabilities = augmentCapabilities;
exports.validateWindowFrames = validateWindowFrames;
exports.validateSourceSyntax = validateSourceSyntax;

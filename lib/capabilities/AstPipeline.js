'use strict';

var Parser = require('./Parser');
var Compiler = require('./Compiler');

function collectCapabilities(ast) {
  if (!ast || ast.type !== 'SelectStatement') throw new TypeError('M8 capability extraction currently supports SelectStatement only');
  var paths = ['statements.select'];
  if (ast.distinct) paths.push('queries.distinct.standard');
  ast.joins.forEach(function (entry) { paths.push('queries.joins.' + entry.kind.toLowerCase()); });
  if (ast.groupBy.length) paths.push('queries.grouping.groupBy');
  if (ast.having) paths.push('queries.grouping.having');
  if (ast.orderBy.length) paths.push('queries.ordering.orderBy');
  if (ast.limit) paths.push('queries.pagination.limit');
  if (ast.offset) paths.push('queries.pagination.offset');
  var seen = Object.create(null);
  return Object.freeze(paths.filter(function (path) { if (seen[path]) return false; seen[path] = true; return true; }));
}

function create(core, normalizeDialect, rewriteApi) {
  function parseSql(dialect, sql) {
    return Parser.parse(sql, normalizeDialect(dialect), core);
  }

  function analyzeAst(ast) {
    var capabilities = collectCapabilities(ast);
    return core.deepFreeze({ statementType: ast.type, capabilities: capabilities });
  }

  function compileAst(dialect, ast) {
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
      scope: 'select-foundation-v1',
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

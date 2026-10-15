'use strict';

var ForeignKeySemantics = require('./ForeignKeySemantics');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function addUnique(values, value) { if (values.indexOf(value) === -1) values.push(value); }
function relevant(ast) {
  var refs = ForeignKeySemantics.collect(ast);
  return ForeignKeySemantics.isForeignKeyAdd(ast) || refs.some(ForeignKeySemantics.has);
}
function hasMySqlNoActionRisk(ast) {
  return ForeignKeySemantics.collect(ast).some(function (reference) {
    return reference.onDelete === 'no-action' || reference.onUpdate === 'no-action';
  });
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function validateSourceDialect(dialect, ast) {
    ForeignKeySemantics.collect(ast).forEach(function (reference) {
      ForeignKeySemantics.validateSourceDialect(dialect, reference);
    });
  }
  function validateTargetDialect(dialect, ast) {
    if (ForeignKeySemantics.isForeignKeyAdd(ast) && dialect === 'sqlite') {
      throw new RangeError('SQLite ddl-v7 standalone ADD CONSTRAINT FOREIGN KEY requires a table-rebuild strategy');
    }
    ForeignKeySemantics.collect(ast).forEach(function (reference) {
      ForeignKeySemantics.validateTargetDialect(dialect, reference);
    });
  }
  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var ast = baseApi.parseSql(source, sql);
    if (!relevant(ast)) return ast;
    validateSourceDialect(source, ast);
    return ast;
  }
  function analyzeAst(ast) {
    if (!relevant(ast)) return baseApi.analyzeAst(ast);
    var base = baseApi.analyzeAst(ast);
    var capabilities = (base.capabilities || []).filter(function (path) {
      return !(ForeignKeySemantics.isForeignKeyAdd(ast) && path === 'schema.tableAlter.addConstraint');
    });
    if (ForeignKeySemantics.isForeignKeyAdd(ast)) {
      addUnique(capabilities, 'schema.tableAlter.addForeignKey');
      addUnique(capabilities, 'integrity.foreignKey');
    }
    ForeignKeySemantics.collect(ast).forEach(function (reference) {
      ForeignKeySemantics.capabilities(reference).forEach(function (path) { addUnique(capabilities, path); });
    });
    capabilities.sort();
    return deepFreeze({ statementType: base.statementType || ast.type, scope: 'ddl-v7', capabilities: capabilities });
  }
  function compileAst(dialect, ast) {
    if (!relevant(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect);
    validateTargetDialect(target, ast);
    return baseApi.compileAst(target, ast);
  }
  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from);
    var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    if (!relevant(ast)) return baseApi.transpileSql(source, target, sql, options);
    var analysis = analyzeAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v7 transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v7 transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) {
      return entry.action === 'emulate' || (entry.action === 'rewrite' && !(entry.level === 'exact' && entry.lossless === true));
    })) {
      throw new RangeError('DDL ddl-v7 transpilation requires an explicit semantic transformation');
    }
    if (source !== target && (source === 'mysql' || target === 'mysql') && hasMySqlNoActionRisk(ast)) {
      throw new RangeError('Cross-dialect NO ACTION involving MySQL requires an explicit semantic decision because enforcement timing is engine-dependent');
    }
    validateTargetDialect(target, ast);
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({
      from: source,
      to: target,
      scope: 'ddl-v7',
      ast: ast,
      capabilities: analysis.capabilities,
      plan: plan,
      sql: compiled.sql,
      targetToSource: compiled.targetToSource || [],
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
exports.relevant = relevant;

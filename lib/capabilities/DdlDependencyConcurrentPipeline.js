'use strict';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}
function isAdvanced(ast) { return !!(ast && (ast.concurrently === true || ast.dependencyMode)); }
function cloneBase(ast) {
  var copy = {};
  Object.keys(ast).forEach(function (key) {
    if (key !== 'concurrently' && key !== 'dependencyMode') copy[key] = ast[key];
  });
  return copy;
}
function dependencyCapability(mode) {
  return mode === 'cascade' ? 'syntax.dropDependency.cascade' : mode === 'restrict' ? 'syntax.dropDependency.restrict' : null;
}

function create(baseApi, normalizeDialect, rewriteApi) {
  function validate(ast) {
    if (!isAdvanced(ast)) throw new TypeError('NuBloxSQL ddl-v5 AST requires concurrent index or dependency behavior');
    baseApi.analyzeAst(cloneBase(ast));
    if (ast.concurrently) {
      if (ast.type !== 'CreateIndexStatement' && ast.type !== 'DropIndexStatement') throw new RangeError('CONCURRENTLY is only valid for CREATE INDEX or DROP INDEX in ddl-v5');
      if (ast.type === 'DropIndexStatement' && ast.dependencyMode === 'cascade') throw new RangeError('PostgreSQL DROP INDEX CONCURRENTLY cannot be combined with CASCADE');
    }
    if (ast.dependencyMode && ['DropTableStatement','DropViewStatement','DropIndexStatement','DropSchemaStatement','DropSequenceStatement'].indexOf(ast.type) === -1) {
      throw new RangeError('CASCADE/RESTRICT is only valid for released DROP statements in ddl-v5');
    }
    if (ast.dependencyMode && ast.dependencyMode !== 'cascade' && ast.dependencyMode !== 'restrict') throw new RangeError('Invalid ddl-v5 dependency mode');
    return ast;
  }
  function sourceGuard(dialect, advanced) {
    if ((advanced.concurrently || advanced.dependencyMode) && dialect !== 'postgresql') {
      throw new SyntaxError('ddl-v5 CONCURRENTLY and explicit DROP dependency behavior are PostgreSQL source semantics');
    }
  }
  function targetGuard(dialect, ast) {
    if ((ast.concurrently || ast.dependencyMode) && dialect !== 'postgresql') {
      throw new RangeError('ddl-v5 concurrent index and DROP dependency semantics are PostgreSQL-only and are not lowered cross-dialect');
    }
  }
  function extract(sql) {
    var working = sql;
    var concurrently = false;
    var dependencyMode = null;
    if (/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(working)) {
      concurrently = true;
      working = working.replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX)\s+CONCURRENTLY\b/i, '$1');
    } else if (/^\s*DROP\s+INDEX\s+CONCURRENTLY\b/i.test(working)) {
      concurrently = true;
      working = working.replace(/^(\s*DROP\s+INDEX)\s+CONCURRENTLY\b/i, '$1');
    }
    var dependencyMatch = /\s+(CASCADE|RESTRICT)\s*(;?)\s*$/i.exec(working);
    if (dependencyMatch) {
      dependencyMode = dependencyMatch[1].toLowerCase();
      working = working.slice(0, dependencyMatch.index) + (dependencyMatch[2] || '');
    }
    return { sql: working, concurrently: concurrently, dependencyMode: dependencyMode };
  }
  function decorate(ast, advanced) {
    if (!advanced.concurrently && !advanced.dependencyMode) return ast;
    var copy = {};
    Object.keys(ast).forEach(function (key) { copy[key] = ast[key]; });
    if (advanced.concurrently) copy.concurrently = true;
    if (advanced.dependencyMode) copy.dependencyMode = advanced.dependencyMode;
    return copy;
  }
  function parseSql(dialect, sql) {
    var source = normalizeDialect(dialect);
    var advanced = extract(sql);
    if (!advanced.concurrently && !advanced.dependencyMode) return baseApi.parseSql(source, sql);
    sourceGuard(source, advanced);
    var ast = decorate(baseApi.parseSql(source, advanced.sql), advanced);
    validate(ast);
    return deepFreeze(ast);
  }
  function analyzeAst(ast) {
    if (!isAdvanced(ast)) return baseApi.analyzeAst(ast);
    validate(ast);
    var analysis = baseApi.analyzeAst(cloneBase(ast));
    var capabilities = analysis.capabilities.slice();
    if (ast.concurrently) {
      var concurrentCapability = ast.type === 'CreateIndexStatement' ? 'schema.concurrentIndexBuild' : 'schema.concurrentIndexDrop';
      if (capabilities.indexOf(concurrentCapability) === -1) capabilities.push(concurrentCapability);
    }
    var dependency = dependencyCapability(ast.dependencyMode);
    if (dependency && capabilities.indexOf(dependency) === -1) capabilities.push(dependency);
    capabilities.sort();
    return deepFreeze({ statementType: ast.type, scope: 'ddl-v5', capabilities: capabilities });
  }
  function compileAst(dialect, ast) {
    if (!isAdvanced(ast)) return baseApi.compileAst(dialect, ast);
    var target = normalizeDialect(dialect);
    validate(ast); targetGuard(target, ast);
    var compiled = baseApi.compileAst(target, cloneBase(ast));
    var sql = compiled.sql;
    if (ast.concurrently && ast.type === 'CreateIndexStatement') sql = sql.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i, '$1 CONCURRENTLY ');
    if (ast.concurrently && ast.type === 'DropIndexStatement') sql = sql.replace(/^(DROP\s+INDEX)\s+/i, '$1 CONCURRENTLY ');
    if (ast.dependencyMode) sql += ' ' + ast.dependencyMode.toUpperCase();
    return deepFreeze({ dialect: target, sql: sql, targetToSource: compiled.targetToSource ? compiled.targetToSource.slice() : [] });
  }
  function transpileSql(from, to, sql, options) {
    options = options || {};
    var source = normalizeDialect(from); var target = normalizeDialect(to);
    var ast = parseSql(source, sql);
    if (!isAdvanced(ast)) return baseApi.transpileSql(source, target, sql, options);
    targetGuard(target, ast);
    var analysis = analyzeAst(ast);
    var plan = rewriteApi.plan(source, target, analysis.capabilities, options);
    if (plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v5 transpilation is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('DDL ddl-v5 transpilation requires runtime qualification for: ' + unresolved.join(', '));
    }
    if (plan.decisions.some(function (entry) { return entry.action === 'emulate' || entry.action === 'rewrite'; })) throw new RangeError('DDL ddl-v5 transpilation requires an explicit semantic transformation');
    var compiled = compileAst(target, ast);
    var lossless = plan.decisions.every(function (entry) { return entry.lossless !== false && entry.action !== 'emulate'; });
    return deepFreeze({ from: source, to: target, scope: 'ddl-v5', ast: ast, capabilities: analysis.capabilities, plan: plan, sql: compiled.sql, targetToSource: compiled.targetToSource, lossless: lossless, certified: plan.safeToProceed && lossless });
  }
  return Object.freeze({ parseSql: parseSql, analyzeAst: analyzeAst, compileAst: compileAst, transpileSql: transpileSql });
}

exports.create = create;
exports.isAdvancedAst = isAdvanced;

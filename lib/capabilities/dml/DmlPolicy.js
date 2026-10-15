'use strict';

function isStatement(ast, type) { return !!(ast && ast.type === type); }

function inspectScalar(value, label) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(function (entry) { inspectScalar(entry, label); });
    return;
  }

  // A scalar subquery is its own validated query scope. Do not apply outer-DML
  // scalar restrictions to nodes inside that query (for example COUNT(*)).
  if (value.type === 'SubqueryExpression') return;

  if (value.type === 'Wildcard') {
    throw new RangeError(label + ' cannot contain a wildcard');
  }
  if (value.type === 'WindowExpression') {
    throw new RangeError(label + ' cannot contain a window expression');
  }

  Object.keys(value).forEach(function (key) {
    inspectScalar(value[key], label);
  });
}

function inspectAssignments(assignments, label) {
  if (!Array.isArray(assignments)) return;
  assignments.forEach(function (assignment) {
    if (assignment && assignment.value) inspectScalar(assignment.value, label);
  });
}

function validateStatement(ast) {
  if (!ast || typeof ast !== 'object') return ast;

  if (isStatement(ast, 'InsertStatement')) {
    if (Array.isArray(ast.rows)) {
      ast.rows.forEach(function (row) {
        inspectScalar(row, 'INSERT VALUES expression');
      });
    }
    return ast;
  }

  if (isStatement(ast, 'UpdateStatement')) {
    inspectAssignments(ast.assignments, 'UPDATE assignment expression');
    if (ast.where) inspectScalar(ast.where, 'UPDATE WHERE expression');
    return ast;
  }

  if (isStatement(ast, 'DeleteStatement')) {
    if (ast.where) inspectScalar(ast.where, 'DELETE WHERE expression');
    return ast;
  }

  if (isStatement(ast, 'UpsertStatement')) {
    if (ast.insert) validateStatement(ast.insert);
    if (ast.conflict) {
      inspectAssignments(ast.conflict.assignments, 'UPSERT assignment expression');
      if (ast.conflict.where) inspectScalar(ast.conflict.where, 'UPSERT WHERE expression');
    }
    return ast;
  }

  if (isStatement(ast, 'MergeStatement')) {
    if (ast.on) inspectScalar(ast.on, 'MERGE ON expression');
    if (ast.matched) inspectAssignments(ast.matched.assignments, 'MERGE assignment expression');
    if (ast.notMatched && Array.isArray(ast.notMatched.values)) {
      inspectScalar(ast.notMatched.values, 'MERGE INSERT expression');
    }
    return ast;
  }

  return ast;
}

function create(baseApi) {
  if (!baseApi || typeof baseApi.parseSql !== 'function' || typeof baseApi.analyzeAst !== 'function' ||
      typeof baseApi.compileAst !== 'function' || typeof baseApi.transpileSql !== 'function') {
    throw new TypeError('DML policy requires a complete AST pipeline');
  }

  function parseSql(dialect, sql) {
    return validateStatement(baseApi.parseSql(dialect, sql));
  }

  function analyzeAst(ast) {
    validateStatement(ast);
    return baseApi.analyzeAst(ast);
  }

  function compileAst(dialect, ast) {
    validateStatement(ast);
    return baseApi.compileAst(dialect, ast);
  }

  function transpileSql(from, to, sql, options) {
    // Validate the source AST through this policy before delegating to the
    // underlying pipeline, whose internal parse/compile closures are private.
    parseSql(from, sql);
    return baseApi.transpileSql(from, to, sql, options);
  }

  return Object.freeze({
    parseSql: parseSql,
    analyzeAst: analyzeAst,
    compileAst: compileAst,
    transpileSql: transpileSql
  });
}

exports.create = create;
exports.validateStatement = validateStatement;

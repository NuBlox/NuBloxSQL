'use strict';

var errors = require('./Error');

var SCHEMA_VERSION = 1;

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function freezeWarnings(values) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.map(function (entry) {
    entry = entry || {};
    return Object.freeze({
      code: entry.code === undefined ? 'native-warning' : String(entry.code),
      message: entry.message === undefined ? String(entry.detail || '') : String(entry.message),
      nodeId: entry.nodeId === undefined || entry.nodeId === null ? null : Number(entry.nodeId)
    });
  }));
}

function normalizeSummary(dialect, native) {
  native = native || {};
  var summary = native.summary || {};

  if (dialect === 'sqlite') {
    summary = native.plan && native.plan.summary ? native.plan.summary : {};
    return Object.freeze({
      nodeCount: numberOrNull(summary.nodeCount),
      maxDepth: null,
      estimatedRows: null,
      actualRows: null,
      estimatedCost: null,
      planningTimeMs: null,
      executionTimeMs: null
    });
  }

  if (dialect === 'postgresql') {
    return Object.freeze({
      nodeCount: numberOrNull(summary.nodeCount),
      maxDepth: numberOrNull(summary.maxDepth),
      estimatedRows: numberOrNull(summary.planRows),
      actualRows: numberOrNull(summary.actualRows),
      estimatedCost: numberOrNull(summary.totalCost),
      planningTimeMs: numberOrNull(summary.planningTime),
      executionTimeMs: numberOrNull(summary.executionTime)
    });
  }

  if (dialect === 'mysql') {
    return Object.freeze({
      nodeCount: numberOrNull(summary.nodeCount),
      maxDepth: numberOrNull(summary.maxDepth),
      estimatedRows: numberOrNull(summary.estimatedRows),
      actualRows: numberOrNull(summary.actualRows),
      estimatedCost: numberOrNull(summary.estimatedTotalCost),
      planningTimeMs: null,
      executionTimeMs: null
    });
  }

  return Object.freeze({
    nodeCount: null,
    maxDepth: null,
    estimatedRows: null,
    actualRows: null,
    estimatedCost: null,
    planningTimeMs: null,
    executionTimeMs: null
  });
}

function nativeWarnings(dialect, native) {
  if (dialect === 'sqlite' && native && native.plan) return freezeWarnings(native.plan.warnings);
  return Object.freeze([]);
}

function bindParameters(client, parameters) {
  var services = client.descriptor && client.descriptor.services;
  if (!services || typeof services.bindParameter !== 'function') return parameters.slice();
  return parameters.map(function (value, index) { return services.bindParameter(value, index); });
}

function normalizeReport(client, compiled, native, options) {
  options = options || {};
  var analyzed = !!(native && native.analyzed === true);
  var statementExecuted = !!(native && native.statementExecuted === true);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    dialect: client.dialect,
    mode: analyzed ? 'analyze' : 'plan',
    analyzed: analyzed,
    statementExecuted: statementExecuted,
    statement: Object.freeze({
      text: compiled.text,
      parameterCount: compiled.parameters.length
    }),
    summary: normalizeSummary(client.dialect, native),
    warnings: nativeWarnings(client.dialect, native),
    native: native
  });
}

function validateOptions(options) {
  if (options === undefined || options === null) return {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('NuBloxSQL diagnose options must be an object');
  }
  if (options.analyze !== undefined && typeof options.analyze !== 'boolean') {
    throw new TypeError('NuBloxSQL diagnose analyze must be a boolean');
  }
  return options;
}

function install(clientApi) {
  var Client = clientApi.Client;
  if (!Client || Client.prototype.diagnose) return;

  Client.prototype.diagnose = async function diagnose(statement, options) {
    options = validateOptions(options);
    if (!this.supports('queryDiagnostics')) throw errors.unsupportedError(this.dialect, 'query diagnostics');

    var compiled = this.compile(statement);
    var target = await this._ensureConnected();
    var parameters = bindParameters(this, compiled.parameters);
    var native;

    if (options.analyze === true) {
      if (typeof target.explainAnalyze !== 'function') {
        throw errors.unsupportedError(this.dialect, 'query diagnostics with execution analysis');
      }
      native = await Promise.resolve(target.explainAnalyze(compiled.text, parameters, options));
    } else if (typeof target.diagnoseQuery === 'function') {
      native = await Promise.resolve(target.diagnoseQuery(compiled.text, parameters, options));
    } else if (typeof target.explain === 'function') {
      native = await Promise.resolve(target.explain(compiled.text, parameters, options));
    } else {
      throw errors.unsupportedError(this.dialect, 'query diagnostics');
    }

    return normalizeReport(this, compiled, native, options);
  };
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.install = install;
exports.normalizeReport = normalizeReport;
exports.normalizeSummary = normalizeSummary;

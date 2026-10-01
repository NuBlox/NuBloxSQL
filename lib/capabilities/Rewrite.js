'use strict';

function freeze(core, value) { return core.deepFreeze(value); }

function runtimeEntry(report, path, dialect) {
  if (!report || report.dialect !== dialect || !Array.isArray(report.entries)) return null;
  for (var i = 0; i < report.entries.length; i += 1) {
    if (report.entries[i].path === path) return report.entries[i];
  }
  return null;
}

function effectiveFeature(core, feature, runtime) {
  if (!core.isFeature(feature)) return null;
  if (!runtime || runtime.resolved !== true) return feature;
  var copy = {};
  Object.keys(feature).forEach(function (key) { copy[key] = feature[key]; });
  copy.supported = runtime.supported;
  copy.support = runtime.support;
  return freeze(core, copy);
}

function classify(source, target) {
  if (!source) return { action: 'reject', level: 'unknown', lossless: false, reason: 'Source capability is not modelled.' };
  if (source.supported === false) return { action: 'reject', level: 'source-unavailable', lossless: false, reason: 'Source dialect does not provide this capability.' };
  if (source.supported === null) return { action: 'qualify', level: 'runtime-dependent', lossless: null, reason: 'Source capability requires runtime qualification.' };
  if (!target) return { action: 'reject', level: 'unknown', lossless: false, reason: 'Target capability is not modelled.' };
  if (target.supported === null || target.support === 'runtime-dependent' || target.support === 'unknown') {
    return { action: 'qualify', level: 'runtime-dependent', lossless: null, reason: 'Target capability requires runtime qualification.' };
  }
  if (target.supported === false || target.support === 'unsupported' || target.support === 'not-applicable') {
    return { action: 'reject', level: target.support === 'not-applicable' ? 'not-applicable' : 'unsupported', lossless: false, reason: 'Target dialect cannot represent this capability.' };
  }
  if (target.support === 'partial') return { action: 'reject', level: 'partial', lossless: false, reason: 'Target support is partial and is not safe for an automatic rewrite.' };
  if (target.support === 'emulated') return { action: 'emulate', level: 'emulated', lossless: null, reason: 'Target requires an emulation strategy.' };
  if (target.support === 'equivalent') return { action: 'rewrite', level: 'equivalent', lossless: null, reason: 'Target exposes an equivalent construct that requires an explicit rewrite.' };

  var syntaxDiffers = !!(source.syntax || target.syntax) && source.syntax !== target.syntax;
  return {
    action: syntaxDiffers ? 'rewrite' : 'preserve',
    level: 'exact',
    lossless: true,
    reason: syntaxDiffers ? 'Both dialects support the capability natively but use different documented syntax.' : 'Capability can be preserved without a semantic rewrite.'
  };
}

function createPlanner(core, normalizeDialect, models) {
  function decision(from, to, path, options) {
    options = options || {};
    var sourceDialect = normalizeDialect(from);
    var targetDialect = normalizeDialect(to);
    if (typeof path !== 'string' || path.trim().length === 0) throw new TypeError('SQL rewrite decision path must be a non-empty string');
    var sourceStatic = core.getPath(models[sourceDialect], path);
    var targetStatic = core.getPath(models[targetDialect], path);
    var sourceRuntime = runtimeEntry(options.sourceQualification, path, sourceDialect);
    var targetRuntime = runtimeEntry(options.targetQualification, path, targetDialect);
    var source = effectiveFeature(core, sourceStatic, sourceRuntime);
    var target = effectiveFeature(core, targetStatic, targetRuntime);
    var classification = classify(source, target);
    return freeze(core, {
      path: path,
      from: sourceDialect,
      to: targetDialect,
      action: classification.action,
      level: classification.level,
      lossless: classification.lossless,
      reason: classification.reason,
      source: source,
      target: target,
      sourceResolution: sourceRuntime ? sourceRuntime.resolution : 'static',
      targetResolution: targetRuntime ? targetRuntime.resolution : 'static'
    });
  }

  function plan(from, to, paths, options) {
    if (!Array.isArray(paths) || paths.length === 0) throw new TypeError('SQL rewrite plan requires at least one capability path');
    var seen = Object.create(null);
    var decisions = [];
    paths.forEach(function (path) {
      if (typeof path !== 'string' || path.trim().length === 0) throw new TypeError('SQL rewrite plan capability paths must be non-empty strings');
      path = path.trim();
      if (seen[path]) return;
      seen[path] = true;
      decisions.push(decision(from, to, path, options));
    });
    var summary = { preserve: 0, rewrite: 0, emulate: 0, qualify: 0, reject: 0 };
    decisions.forEach(function (entry) { summary[entry.action] += 1; });
    return freeze(core, {
      from: normalizeDialect(from),
      to: normalizeDialect(to),
      decisions: decisions,
      summary: summary,
      blocked: summary.reject > 0,
      requiresQualification: summary.qualify > 0,
      requiresTransformation: summary.rewrite > 0 || summary.emulate > 0,
      safeToProceed: summary.reject === 0 && summary.qualify === 0
    });
  }

  return Object.freeze({ decision: decision, plan: plan });
}

function isIdentifierStart(ch) { return /[A-Za-z_]/.test(ch || ''); }
function isIdentifierPart(ch) { return /[A-Za-z0-9_]/.test(ch || ''); }
function isDigit(ch) { return /[0-9]/.test(ch || ''); }

function rewriteParameters(from, to, sql) {
  if (typeof sql !== 'string') throw new TypeError('SQL rewrite requires a SQL string');
  var source = from;
  var target = to;
  if (source === target || (source === 'mysql' && target === 'sqlite')) {
    return { sql: sql, changed: false, targetToSource: [], sourceStyle: source === 'postgresql' ? 'numbered-dollar' : 'qmark', targetStyle: target === 'postgresql' ? 'numbered-dollar' : 'qmark' };
  }

  var out = '';
  var targetToSource = [];
  var i = 0;
  var nextSourceIndex = 1;
  var sqliteMaxIndex = 0;
  var sqliteNames = Object.create(null);
  var targetIndex = 0;

  function emitMarker(sourceBinding) {
    targetIndex += 1;
    targetToSource.push(sourceBinding);
    if (target === 'postgresql') return '$' + targetIndex;
    if (target === 'sqlite' && source === 'postgresql' && typeof sourceBinding === 'number') return '?' + sourceBinding;
    return '?';
  }

  while (i < sql.length) {
    var ch = sql[i];
    var next = sql[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      var quote = ch;
      out += ch;
      i += 1;
      while (i < sql.length) {
        ch = sql[i];
        out += ch;
        i += 1;
        if (ch === '\\' && source === 'mysql' && i < sql.length) { out += sql[i]; i += 1; continue; }
        if (ch === quote) {
          if (sql[i] === quote) { out += sql[i]; i += 1; continue; }
          break;
        }
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      var lineEnd = sql.indexOf('\n', i + 2);
      if (lineEnd === -1) { out += sql.slice(i); break; }
      out += sql.slice(i, lineEnd + 1); i = lineEnd + 1; continue;
    }
    if (source === 'mysql' && ch === '#') {
      var hashEnd = sql.indexOf('\n', i + 1);
      if (hashEnd === -1) { out += sql.slice(i); break; }
      out += sql.slice(i, hashEnd + 1); i = hashEnd + 1; continue;
    }
    if (ch === '/' && next === '*') {
      var depth = 1;
      var j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      out += sql.slice(i, j); i = j; continue;
    }

    if (source === 'postgresql' && ch === '$') {
      var dollarTag = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (dollarTag) {
        var tag = dollarTag[0];
        var close = sql.indexOf(tag, i + tag.length);
        if (close === -1) { out += sql.slice(i); break; }
        out += sql.slice(i, close + tag.length); i = close + tag.length; continue;
      }
      if (isDigit(next)) {
        var end = i + 1;
        while (isDigit(sql[end])) end += 1;
        var pgIndex = Number(sql.slice(i + 1, end));
        if (!Number.isSafeInteger(pgIndex) || pgIndex < 1) throw new RangeError('PostgreSQL parameter markers must use a positive index');
        out += emitMarker(pgIndex); i = end; continue;
      }
    }

    if (source === 'mysql' && ch === '?') {
      out += emitMarker(nextSourceIndex); nextSourceIndex += 1; i += 1; continue;
    }

    if (source === 'sqlite') {
      if (ch === '?') {
        var qEnd = i + 1;
        while (isDigit(sql[qEnd])) qEnd += 1;
        var explicit = qEnd > i + 1 ? Number(sql.slice(i + 1, qEnd)) : null;
        var sqliteIndex;
        if (explicit !== null) {
          if (!Number.isSafeInteger(explicit) || explicit < 1) throw new RangeError('SQLite numbered parameter markers must use a positive index');
          sqliteIndex = explicit;
          if (explicit > sqliteMaxIndex) sqliteMaxIndex = explicit;
        } else {
          sqliteIndex = sqliteMaxIndex + 1;
          sqliteMaxIndex = sqliteIndex;
        }
        out += emitMarker(sqliteIndex); i = qEnd; continue;
      }
      if ((ch === ':' || ch === '@' || ch === '$') && isIdentifierStart(next)) {
        var nEnd = i + 2;
        while (isIdentifierPart(sql[nEnd])) nEnd += 1;
        var name = sql.slice(i, nEnd);
        if (!sqliteNames[name]) { sqliteMaxIndex += 1; sqliteNames[name] = sqliteMaxIndex; }
        out += emitMarker(name); i = nEnd; continue;
      }
    }

    out += ch;
    i += 1;
  }

  return {
    sql: out,
    changed: out !== sql,
    targetToSource: targetToSource,
    sourceStyle: source === 'postgresql' ? 'numbered-dollar' : source === 'sqlite' ? 'sqlite-native' : 'qmark',
    targetStyle: target === 'postgresql' ? 'numbered-dollar' : target === 'sqlite' ? 'sqlite-native' : 'qmark'
  };
}

function create(core, normalizeDialect, models) {
  var planner = createPlanner(core, normalizeDialect, models);

  function rewriteSql(from, to, sql, options) {
    options = options || {};
    var sourceDialect = normalizeDialect(from);
    var targetDialect = normalizeDialect(to);
    var parameters = rewriteParameters(sourceDialect, targetDialect, sql);
    var requestedPaths = options.capabilities || [];
    var plan = requestedPaths.length ? planner.plan(sourceDialect, targetDialect, requestedPaths, options) : null;
    if (plan && plan.blocked && options.allowBlocked !== true) {
      var blocked = plan.decisions.filter(function (entry) { return entry.action === 'reject'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL rewrite is blocked by unsupported target capabilities: ' + blocked.join(', '));
    }
    if (plan && plan.requiresQualification && options.allowUnqualified !== true) {
      var unresolved = plan.decisions.filter(function (entry) { return entry.action === 'qualify'; }).map(function (entry) { return entry.path; });
      throw new RangeError('SQL rewrite requires runtime qualification for: ' + unresolved.join(', '));
    }
    var rules = [];
    if (parameters.changed) rules.push(freeze(core, { id: 'parameter-markers', lossless: true }));
    return freeze(core, {
      from: sourceDialect,
      to: targetDialect,
      input: sql,
      sql: parameters.sql,
      changed: parameters.changed,
      lossless: true,
      rules: rules,
      parameters: {
        sourceStyle: parameters.sourceStyle,
        targetStyle: parameters.targetStyle,
        targetToSource: parameters.targetToSource
      },
      plan: plan
    });
  }

  return Object.freeze({
    decision: planner.decision,
    plan: planner.plan,
    rewriteSql: rewriteSql
  });
}

exports.create = create;
exports.rewriteParameters = rewriteParameters;

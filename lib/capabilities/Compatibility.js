'use strict';

function collectFeaturePaths(core, object, prefix, out) {
  Object.keys(object || {}).forEach(function (key) {
    var value = object[key];
    var path = prefix ? prefix + '.' + key : key;
    if (core.isFeature(value)) out[path] = true;
    else if (value && typeof value === 'object' && !Array.isArray(value)) collectFeaturePaths(core, value, path, out);
  });
  return out;
}

function reason(code, message) {
  return Object.freeze({ code: code, message: message });
}

function analyze(core, sourceDialect, targetDialect, path, source, target) {
  var reasons = [];
  var level = 'unknown';
  var compatible = null;
  var rewriteRequired = null;
  var lossless = null;

  if (!source) {
    reasons.push(reason('source-unmodelled', 'Source dialect does not model this capability path.'));
  } else if (source.support === 'unsupported' || source.support === 'not-applicable') {
    level = 'source-unavailable';
    reasons.push(reason('source-unavailable', 'Source dialect does not provide this capability, so transfer compatibility is not applicable.'));
  } else if (source.supported === null) {
    level = 'runtime-dependent';
    reasons.push(reason('source-runtime-dependent', 'Source capability depends on runtime, version or build evidence.'));
  } else if (!target) {
    level = 'unknown';
    reasons.push(reason('target-unmodelled', 'Target dialect does not model this capability path.'));
  } else if (target.support === 'native') {
    level = 'exact';
    compatible = true;
    rewriteRequired = source.syntax !== target.syntax && !!(source.syntax || target.syntax);
    lossless = true;
    if (rewriteRequired) reasons.push(reason('syntax-differs', 'The target supports the capability natively but uses different syntax.'));
  } else if (target.support === 'equivalent') {
    level = 'equivalent';
    compatible = true;
    rewriteRequired = true;
    lossless = null;
    reasons.push(reason('semantic-equivalent', 'The target exposes an equivalent native concept under different semantics or syntax.'));
  } else if (target.support === 'emulated') {
    level = 'emulated';
    compatible = true;
    rewriteRequired = true;
    lossless = null;
    reasons.push(reason('emulation-required', 'The target requires NuBloxSQL or application-level emulation.'));
  } else if (target.support === 'partial') {
    level = 'partial';
    compatible = false;
    rewriteRequired = true;
    lossless = false;
    reasons.push(reason('partial-target-support', 'The target supports only part of the source capability semantics.'));
  } else if (target.support === 'runtime-dependent' || target.support === 'unknown') {
    level = 'runtime-dependent';
    compatible = null;
    rewriteRequired = null;
    lossless = null;
    reasons.push(reason('target-runtime-dependent', 'Target support requires runtime, version or build qualification.'));
  } else if (target.support === 'unsupported') {
    level = 'unsupported';
    compatible = false;
    rewriteRequired = null;
    lossless = false;
    reasons.push(reason('target-unsupported', 'The target dialect does not support this capability.'));
  } else if (target.support === 'not-applicable') {
    level = 'not-applicable';
    compatible = false;
    rewriteRequired = null;
    lossless = false;
    reasons.push(reason('target-not-applicable', 'The capability does not apply to the target database architecture.'));
  }

  if (source && target && source.restrictions && source.restrictions.length) {
    reasons.push(reason('source-restrictions', 'The source capability has documented restrictions that may affect transfer.'));
  }
  if (source && target && target.restrictions && target.restrictions.length) {
    reasons.push(reason('target-restrictions', 'The target capability has documented restrictions that may affect transfer.'));
  }

  return core.deepFreeze({
    path: path,
    from: sourceDialect,
    to: targetDialect,
    source: source || null,
    target: target || null,
    compatible: compatible,
    level: level,
    rewriteRequired: rewriteRequired,
    lossless: lossless,
    reasons: reasons
  });
}

function create(core, normalizeDialect, models) {
  function compatibility(from, to, path) {
    var sourceDialect = normalizeDialect(from);
    var targetDialect = normalizeDialect(to);
    if (typeof path !== 'string' || path.trim().length === 0) throw new TypeError('SQL compatibility path must be a non-empty string');
    var source = core.getPath(models[sourceDialect], path);
    var target = core.getPath(models[targetDialect], path);
    if (!core.isFeature(source)) source = null;
    if (!core.isFeature(target)) target = null;
    return analyze(core, sourceDialect, targetDialect, path, source, target);
  }

  function paths(category) {
    if (core.CATEGORIES.indexOf(category) === -1) throw new RangeError('Unknown SQL capability category: ' + category);
    var set = {};
    Object.keys(models).forEach(function (dialect) {
      collectFeaturePaths(core, models[dialect][category], category, set);
    });
    return Object.freeze(Object.keys(set).sort());
  }

  function compareCategory(category, dialectNames) {
    var names = dialectNames === undefined ? core.TIER1_DIALECTS : dialectNames;
    if (!Array.isArray(names) || names.length === 0) throw new TypeError('SQL category comparison requires at least one dialect');
    var normalized = names.map(normalizeDialect);
    var categoryPaths = paths(category);
    var rows = categoryPaths.map(function (path) {
      var dialects = {};
      var universallySupported = true;
      var determinate = true;
      normalized.forEach(function (dialect) {
        var entry = core.getPath(models[dialect], path);
        entry = core.isFeature(entry) ? entry : null;
        dialects[dialect] = entry;
        if (!entry || entry.supported !== true) universallySupported = false;
        if (!entry || entry.supported === null) determinate = false;
      });
      return core.deepFreeze({ path: path, dialects: dialects, universallySupported: universallySupported, determinate: determinate });
    });
    return core.deepFreeze({ category: category, dialects: normalized, paths: categoryPaths, rows: rows });
  }

  function migrationSurface(from, to, category) {
    var sourceDialect = normalizeDialect(from);
    var targetDialect = normalizeDialect(to);
    var categories = category === undefined ? core.CATEGORIES : [category];
    var results = [];
    categories.forEach(function (name) {
      paths(name).forEach(function (path) {
        var source = core.getPath(models[sourceDialect], path);
        if (core.isFeature(source) && source.supported === true) results.push(compatibility(sourceDialect, targetDialect, path));
      });
    });
    var summary = { exact: 0, equivalent: 0, emulated: 0, partial: 0, runtimeDependent: 0, unsupported: 0, notApplicable: 0, unknown: 0 };
    results.forEach(function (entry) {
      if (entry.level === 'exact') summary.exact += 1;
      else if (entry.level === 'equivalent') summary.equivalent += 1;
      else if (entry.level === 'emulated') summary.emulated += 1;
      else if (entry.level === 'partial') summary.partial += 1;
      else if (entry.level === 'runtime-dependent') summary.runtimeDependent += 1;
      else if (entry.level === 'unsupported') summary.unsupported += 1;
      else if (entry.level === 'not-applicable') summary.notApplicable += 1;
      else summary.unknown += 1;
    });
    return core.deepFreeze({ from: sourceDialect, to: targetDialect, category: category || null, summary: summary, capabilities: results });
  }

  return Object.freeze({ compatibility: compatibility, paths: paths, compareCategory: compareCategory, migrationSurface: migrationSurface });
}

exports.create = create;

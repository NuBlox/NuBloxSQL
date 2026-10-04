'use strict';

function parseVersion(value) {
  var match = String(value || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)];
}

function compareVersion(left, right) {
  var a = parseVersion(left);
  var b = parseVersion(right);
  if (!a || !b) return null;
  for (var i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function freeze(core, value) { return core.deepFreeze(value); }

function resolution(core, path, feature, evidence) {
  var base = {
    path: path,
    static: feature,
    supported: feature.supported,
    support: feature.support,
    resolved: feature.supported !== null,
    resolution: 'static',
    runtimeVersion: evidence.version || null,
    evidence: null,
    reason: null
  };

  var versionComparison = feature.since && evidence.version ? compareVersion(evidence.version, feature.since) : null;
  if (versionComparison !== null && versionComparison < 0) {
    base.supported = false;
    base.support = 'unsupported';
    base.resolved = true;
    base.resolution = 'runtime-version';
    base.evidence = evidence.version;
    base.reason = 'Runtime version predates the documented minimum version ' + feature.since + '.';
    return freeze(core, base);
  }

  if (feature.supported !== null) {
    if (versionComparison !== null) {
      base.resolution = 'runtime-version';
      base.evidence = evidence.version;
      base.reason = 'Runtime version satisfies the documented minimum version.';
    }
    return freeze(core, base);
  }

  var explicit = evidence.features && Object.prototype.hasOwnProperty.call(evidence.features, path)
    ? evidence.features[path]
    : undefined;
  if (typeof explicit === 'boolean') {
    base.supported = explicit;
    base.support = explicit ? 'native' : 'unsupported';
    base.resolved = true;
    base.resolution = 'runtime-probe';
    base.evidence = explicit;
    base.reason = explicit ? 'Runtime probe confirmed support.' : 'Runtime probe confirmed the capability is unavailable.';
    return freeze(core, base);
  }

  if (feature.evidence === 'runtime-version' && feature.since && evidence.version) {
    var comparison = compareVersion(evidence.version, feature.since);
    if (comparison !== null) {
      base.supported = comparison >= 0;
      base.support = comparison >= 0 ? 'native' : 'unsupported';
      base.resolved = true;
      base.resolution = 'runtime-version';
      base.evidence = evidence.version;
      base.reason = comparison >= 0
        ? 'Runtime version satisfies the documented minimum version.'
        : 'Runtime version predates the documented minimum version ' + feature.since + '.';
      return freeze(core, base);
    }
  }

  base.resolution = feature.evidence || 'runtime-dependent';
  base.reason = 'Direct runtime evidence is required before this capability can be resolved.';
  return freeze(core, base);
}

function collect(core, object, prefix, evidence, out) {
  Object.keys(object || {}).forEach(function (key) {
    var value = object[key];
    var path = prefix ? prefix + '.' + key : key;
    if (core.isFeature(value)) out.push(resolution(core, path, value, evidence));
    else if (value && typeof value === 'object' && !Array.isArray(value)) collect(core, value, path, evidence, out);
  });
}

function create(core, normalizeDialect, models) {
  function qualify(dialectName, evidence) {
    var dialect = normalizeDialect(dialectName);
    evidence = evidence || {};
    var entries = [];
    core.CATEGORIES.forEach(function (category) {
      collect(core, models[dialect][category], category, evidence, entries);
    });
    var summary = { total: entries.length, resolved: 0, unresolved: 0, supported: 0, unsupported: 0, runtimeQualified: 0 };
    entries.forEach(function (entry) {
      if (entry.resolved) summary.resolved += 1; else summary.unresolved += 1;
      if (entry.supported === true) summary.supported += 1;
      if (entry.supported === false) summary.unsupported += 1;
      if (entry.resolution === 'runtime-version' || entry.resolution === 'runtime-probe') summary.runtimeQualified += 1;
    });
    return freeze(core, {
      dialect: dialect,
      version: evidence.version || null,
      source: evidence.source || 'supplied-runtime-evidence',
      generatedAt: evidence.generatedAt || null,
      summary: summary,
      entries: entries
    });
  }

  function featureMapFromSqliteNative(native) {
    var features = {};
    if (!native) return features;
    var matrix = typeof native.featureMatrix === 'function' ? native.featureMatrix() : null;
    var runtime = matrix && matrix.features;
    if (runtime) {
      if (typeof runtime.json === 'boolean') features['expressions.json'] = runtime.json;
      if (typeof runtime.jsonb === 'boolean') features['expressions.jsonb'] = runtime.jsonb;
      if (typeof runtime.fts5 === 'boolean') features['extensions.fts5'] = runtime.fts5;
      if (typeof runtime.strictTables === 'boolean') features['schema.strictTable'] = runtime.strictTables;
      if (typeof runtime.returning === 'boolean') features['syntax.returning'] = runtime.returning;
      if (typeof runtime.windowFunctions === 'boolean') {
        features['queries.windows.supported'] = runtime.windowFunctions;
        features['queries.windows.named'] = runtime.windowFunctions;
        features['queries.windows.rows'] = runtime.windowFunctions;
        features['queries.windows.range'] = runtime.windowFunctions;
      }
      if (typeof runtime.customCollations === 'boolean') features['expressions.customCollations'] = runtime.customCollations;
    }
    var ext = typeof native.extensibilityCapabilities === 'function' ? native.extensibilityCapabilities() : null;
    if (ext) {
      if (typeof ext.authorizer === 'boolean') features['security.authorizer'] = ext.authorizer;
      if (typeof ext.defensive === 'boolean') features['security.defensiveMode'] = ext.defensive;
      if (typeof ext.extensionLoading === 'boolean') features['security.extensionLoadingPolicy'] = ext.extensionLoading;
    }
    var changes = typeof native.changesetCapabilities === 'function' ? native.changesetCapabilities() : null;
    if (changes && typeof changes.changesets === 'boolean') features['dataMovement.changesets'] = changes.changesets;
    return features;
  }

  async function qualifyClient(client) {
    if (!client || typeof client.one !== 'function') throw new TypeError('Runtime qualification requires a NuBloxSQL Client');
    var version;
    var features = {};
    if (client.dialect === 'postgresql') {
      var pg = await client.one('SHOW server_version');
      version = pg.server_version || pg.serverVersion || Object.values(pg)[0];
    } else if (client.dialect === 'mysql') {
      var mysql = await client.one('SELECT VERSION() AS version');
      version = mysql.version || Object.values(mysql)[0];
    } else if (client.dialect === 'sqlite') {
      var sqlite = await client.one('SELECT sqlite_version() AS version');
      version = sqlite.version || Object.values(sqlite)[0];
      features = featureMapFromSqliteNative(client.native);
      try {
        var fk = await client.one('PRAGMA foreign_keys');
        var enabled = Number(fk.foreign_keys !== undefined ? fk.foreign_keys : Object.values(fk)[0]) === 1;
        features['integrity.foreignKey'] = enabled;
        features['integrity.deferrableForeignKeys'] = enabled;
        features['integrity.onDeleteCascade'] = enabled;
        features['integrity.onDeleteSetNull'] = enabled;
        features['integrity.onDeleteSetDefault'] = enabled;
        features['integrity.onDeleteRestrict'] = enabled;
        features['integrity.onUpdateCascade'] = enabled;
        features['integrity.onUpdateSetNull'] = enabled;
      } catch (_) {}
    } else {
      throw new RangeError('Runtime capability qualification currently supports Tier-1 dialects: postgresql, mysql, sqlite');
    }
    return qualify(client.dialect, {
      version: String(version),
      features: features,
      source: 'live-client',
      generatedAt: new Date().toISOString()
    });
  }

  return Object.freeze({
    parseVersion: parseVersion,
    compareVersion: compareVersion,
    qualify: qualify,
    qualifyClient: qualifyClient
  });
}

exports.create = create;
exports.parseVersion = parseVersion;
exports.compareVersion = compareVersion;

'use strict';

function freezeArray(values) {
  return Object.freeze(values.map(function (value) {
    return value && typeof value === 'object' && !Object.isFrozen(value) ? Object.freeze(value) : value;
  }));
}

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function unquoteIdentifier(value) {
  value = String(value || '').trim();
  if (value.length < 2) return value;
  var first = value[0];
  var last = value[value.length - 1];
  if (first === '"' && last === '"') return value.slice(1, -1).replace(/""/g, '"');
  if (first === '`' && last === '`') return value.slice(1, -1).replace(/``/g, '`');
  if (first === '[' && last === ']') return value.slice(1, -1).replace(/]]/g, ']');
  return value;
}

function matchingParen(text, open) {
  var depth = 0;
  var quote = null;
  for (var i = open; i < text.length; i++) {
    var ch = text[i];
    if (quote) {
      if (quote === ']' && ch === ']') { quote = null; continue; }
      if (ch === quote) {
        if (text[i + 1] === quote && quote !== ']') { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') { quote = ']'; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(text) {
  var output = [];
  var start = 0;
  var depth = 0;
  var quote = null;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (quote) {
      if (quote === ']' && ch === ']') { quote = null; continue; }
      if (ch === quote) {
        if (text[i + 1] === quote && quote !== ']') { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') { quote = ']'; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      output.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  output.push(text.slice(start).trim());
  return output.filter(function (part) { return part.length > 0; });
}

function tableBody(definition) {
  if (!definition) return null;
  var open = definition.indexOf('(');
  if (open < 0) return null;
  var close = matchingParen(definition, open);
  if (close < 0) return null;
  return { body: definition.slice(open + 1, close), tail: definition.slice(close + 1).trim() };
}

function firstIdentifier(definition) {
  var text = String(definition || '').trim();
  if (!text) return null;
  if (text[0] === '"' || text[0] === '`') {
    var q = text[0];
    for (var i = 1; i < text.length; i++) {
      if (text[i] === q) {
        if (text[i + 1] === q) { i++; continue; }
        return text.slice(0, i + 1);
      }
    }
  }
  if (text[0] === '[') {
    var end = text.indexOf(']');
    if (end >= 0) return text.slice(0, end + 1);
  }
  var match = text.match(/^([^\s]+)/);
  return match ? match[1] : null;
}

function parseGeneratedColumns(definition) {
  var parsed = tableBody(definition);
  var output = Object.create(null);
  if (!parsed) return output;
  splitTopLevel(parsed.body).forEach(function (part) {
    if (/^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b)/i.test(part)) return;
    var token = firstIdentifier(part);
    if (!token) return;
    var name = unquoteIdentifier(token);
    var searchFrom = token.length;
    var asMatch = /(?:GENERATED\s+ALWAYS\s+)?AS\s*\(/ig;
    asMatch.lastIndex = searchFrom;
    var match = asMatch.exec(part);
    if (!match) return;
    var open = part.indexOf('(', match.index);
    var close = matchingParen(part, open);
    if (close < 0) return;
    var tail = part.slice(close + 1);
    output[name] = {
      expression: part.slice(open + 1, close).trim(),
      kind: /\bSTORED\b/i.test(tail) ? 'stored' : 'virtual'
    };
  });
  return output;
}

function parseIndexDefinition(definition) {
  if (!definition) return { parts: [], predicate: null };
  var on = /\bON\b/ig.exec(definition);
  if (!on) return { parts: [], predicate: null };
  var open = definition.indexOf('(', on.index + on[0].length);
  if (open < 0) return { parts: [], predicate: null };
  var close = matchingParen(definition, open);
  if (close < 0) return { parts: [], predicate: null };
  var tail = definition.slice(close + 1);
  var where = /\bWHERE\b/i.exec(tail);
  return {
    parts: splitTopLevel(definition.slice(open + 1, close)),
    predicate: where ? tail.slice(where.index + where[0].length).trim() || null : null
  };
}

function explicitConstraintName(prefix) {
  var match = String(prefix || '').match(/\bCONSTRAINT\s+((?:"(?:""|[^"])+")|(?:`(?:``|[^`])+`)|(?:\[(?:]]|[^\]])+\])|(?:[A-Za-z_][A-Za-z0-9_$]*))\s*$/i);
  return match ? unquoteIdentifier(match[1]) : null;
}

function parseChecks(definition, table) {
  var output = [];
  if (!definition) return output;
  var re = /\bCHECK\s*\(/ig;
  var match;
  while ((match = re.exec(definition))) {
    var open = definition.indexOf('(', match.index);
    var close = matchingParen(definition, open);
    if (close < 0) break;
    var since = Math.max(definition.lastIndexOf(',', match.index), definition.lastIndexOf('(', match.index));
    var name = explicitConstraintName(definition.slice(since + 1, match.index));
    var expression = definition.slice(open + 1, close).trim();
    output.push({
      name: name || 'check_' + table + '_' + (output.length + 1),
      expression: expression,
      definition: 'CHECK (' + expression + ')'
    });
    re.lastIndex = close + 1;
  }
  return output;
}

async function sqliteDefinition(metadata, table, options) {
  var database = options.database || options.schema || 'main';
  var connection = await metadata._sqlite();
  var rows = connection.query('SELECT sql FROM ' + quoteIdentifier(database) + '.sqlite_schema WHERE type = \'table\' AND name = ' + quoteLiteral(table)).rows;
  return rows.length ? rows[0].sql || null : null;
}

function install(metadataApi) {
  var Metadata = metadataApi && metadataApi.Metadata;
  if (!Metadata || !Metadata.prototype || Metadata.prototype.__nubloxSqliteAdvancedMetadataInstalled) return;
  Object.defineProperty(Metadata.prototype, '__nubloxSqliteAdvancedMetadataInstalled', { value: true });

  var originalTables = Metadata.prototype.tables;
  Metadata.prototype.tables = async function tables(options) {
    var values = await originalTables.call(this, options);
    if (this.dialect !== 'sqlite') return values;
    options = options || {};
    var database = options.database || options.schema || 'main';
    var connection = await this._sqlite();
    var rows = connection.query('PRAGMA ' + quoteIdentifier(database) + '.table_list').rows;
    var byName = Object.create(null);
    rows.forEach(function (row) { if (row.schema === database) byName[row.name] = row; });
    return freezeArray(values.map(function (value) {
      var row = byName[value.name];
      if (!row) return value;
      return Object.assign({}, value, {
        strict: Number(row.strict) === 1,
        withoutRowid: Number(row.wr) === 1,
        columnCount: Number(row.ncol),
        native: Object.freeze({ schema: value.native, tableList: row })
      });
    }));
  };

  var originalColumns = Metadata.prototype.columns;
  Metadata.prototype.columns = async function columns(table, options) {
    var values = await originalColumns.call(this, table, options);
    if (this.dialect !== 'sqlite') return values;
    options = options || {};
    var definition = await sqliteDefinition(this, table, options);
    var generated = parseGeneratedColumns(definition);
    return freezeArray(values.map(function (value) {
      var parsed = generated[value.name];
      var hidden = Number(value.hidden) || 0;
      return Object.assign({}, value, {
        generatedKind: parsed ? parsed.kind : (hidden === 3 ? 'stored' : hidden === 2 ? 'virtual' : null),
        generationExpression: parsed ? parsed.expression : null
      });
    }));
  };

  var originalIndexes = Metadata.prototype.indexes;
  Metadata.prototype.indexes = async function indexes(table, options) {
    var values = await originalIndexes.call(this, table, options);
    if (this.dialect !== 'sqlite') return values;
    return freezeArray(values.map(function (value) {
      var parsed = parseIndexDefinition(value.definition);
      var detail = value.native && value.native.columns ? value.native.columns : [];
      var keys = detail.filter(function (entry) { return Number(entry.key) === 1; });
      var keyParts = keys.map(function (entry, index) {
        var raw = parsed.parts[index] || null;
        var expression = entry.name === null && Number(entry.cid) === -2 ? raw : null;
        return Object.freeze({
          ordinal: Number(entry.seqno) + 1,
          column: entry.name === null ? null : entry.name,
          expression: expression,
          collation: entry.coll || null,
          descending: Number(entry.desc) === 1
        });
      });
      return Object.assign({}, value, {
        expressions: freezeArray(keyParts.map(function (part) { return part.expression; })),
        keyParts: freezeArray(keyParts),
        predicate: parsed.predicate
      });
    }));
  };

  var originalForeignKeys = Metadata.prototype.foreignKeys;
  Metadata.prototype.foreignKeys = async function foreignKeys(table, options) {
    var values = await originalForeignKeys.call(this, table, options);
    if (this.dialect !== 'sqlite') return values;
    return freezeArray(values.map(function (value) {
      var first = value.native && value.native[0];
      return Object.assign({}, value, {
        id: first ? Number(first.id) : null,
        sequence: freezeArray((value.native || []).map(function (row) { return Number(row.seq); }))
      });
    }));
  };

  var originalConstraints = Metadata.prototype.constraints;
  Metadata.prototype.constraints = async function constraints(table, options) {
    var values = await originalConstraints.call(this, table, options);
    if (this.dialect !== 'sqlite') return values;
    options = options || {};
    var database = options.database || options.schema || 'main';
    var definition = await sqliteDefinition(this, table, options);
    var checks = parseChecks(definition, table).map(function (check) {
      return Object.freeze({
        database: database,
        schema: database,
        table: table,
        name: check.name,
        type: 'check',
        columns: freezeArray([]),
        definition: check.definition,
        expression: check.expression,
        native: Object.freeze({ source: 'sqlite_schema', expression: check.expression })
      });
    });
    return freezeArray(values.concat(checks));
  };
}

exports.install = install;
exports._parseGeneratedColumns = parseGeneratedColumns;
exports._parseIndexDefinition = parseIndexDefinition;
exports._parseChecks = parseChecks;

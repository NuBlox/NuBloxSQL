'use strict';

function assertFunction(value, label) {
  if (value !== undefined && typeof value !== 'function') throw new TypeError(label + ' must be a function');
}

function TypeRegistry(client, options) {
  options = options || {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('NuBloxSQL types must be an options object');
  assertFunction(options.encode, 'NuBloxSQL types.encode');
  assertFunction(options.decode, 'NuBloxSQL types.decode');
  this.client = client;
  this.encode = options.encode || null;
  this.decode = options.decode || null;
  this.decodeNulls = options.decodeNulls === true;
  this._columns = new Map();
  this._nativeTypes = new Map();

  var columns = options.columns || {};
  Object.keys(columns).forEach(function (name) { this.registerColumn(name, columns[name]); }, this);
  var nativeTypes = options.nativeTypes || {};
  Object.keys(nativeTypes).forEach(function (name) { this.registerNativeType(name, nativeTypes[name]); }, this);
}

TypeRegistry.prototype.registerColumn = function registerColumn(name, decoder) {
  if (typeof name !== 'string' || !name.length) throw new TypeError('NuBloxSQL codec column name must be a non-empty string');
  assertFunction(decoder, 'NuBloxSQL column decoder');
  this._columns.set(name, decoder);
  return this;
};

TypeRegistry.prototype.registerNativeType = function registerNativeType(name, decoder) {
  if (typeof name !== 'string' || !name.length) throw new TypeError('NuBloxSQL native type key must be a non-empty string');
  assertFunction(decoder, 'NuBloxSQL native type decoder');
  this._nativeTypes.set(String(name).toLowerCase(), decoder);
  return this;
};

TypeRegistry.prototype.unregisterColumn = function unregisterColumn(name) { this._columns.delete(name); return this; };
TypeRegistry.prototype.unregisterNativeType = function unregisterNativeType(name) { this._nativeTypes.delete(String(name).toLowerCase()); return this; };

function fieldName(field, fallback) {
  if (!field || typeof field !== 'object') return fallback;
  return field.name || field.columnName || field.column || fallback;
}

function nativeType(field) {
  if (!field || typeof field !== 'object') return null;
  var value = field.nativeType;
  if (value === undefined) value = field.dataType;
  if (value === undefined) value = field.dataTypeOid;
  if (value === undefined) value = field.type;
  if (value === undefined) value = field.columnType;
  return value === undefined || value === null ? null : String(value);
}

TypeRegistry.prototype._decodeValue = function _decodeValue(value, context) {
  if (value === null && !this.decodeNulls) return value;
  var decoder = this._columns.get(context.column);
  if (!decoder && context.nativeType !== null) decoder = this._nativeTypes.get(context.nativeType.toLowerCase());
  if (decoder) value = decoder(value, context);
  if (this.decode) value = this.decode(value, context);
  return value;
};

TypeRegistry.prototype.decodeRows = function decodeRows(rows, fields) {
  if ((!this.decode && this._columns.size === 0 && this._nativeTypes.size === 0) || !Array.isArray(rows)) return rows;
  fields = Array.isArray(fields) ? fields : [];
  var dialect = this.client.dialect;
  return rows.map(function (row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    var out = Object.assign({}, row);
    Object.keys(out).forEach(function (key, index) {
      var field = fields[index] || null;
      var column = fieldName(field, key);
      var context = Object.freeze({ dialect: dialect, column: column, field: field, nativeType: nativeType(field), direction: 'decode' });
      out[key] = this._decodeValue(out[key], context);
    }, this);
    return out;
  }, this);
};

TypeRegistry.prototype.encodeValue = function encodeValue(value, context) {
  if (!this.encode) return value;
  return this.encode(value, Object.freeze(Object.assign({ dialect: this.client.dialect, direction: 'encode' }, context || {})));
};

TypeRegistry.prototype.encodeParameters = function encodeParameters(values) {
  if (!this.encode || !Array.isArray(values)) return values;
  return values.map(function (value, index) { return this.encodeValue(value, { parameterIndex: index }); }, this);
};

TypeRegistry.prototype.decodeResult = function decodeResult(result) {
  if (!result || typeof result !== 'object') return result;
  var rows = this.decodeRows(result.rows, result.fields);
  if (rows === result.rows) return result;
  return Object.assign({}, result, { rows: rows, rowCount: result.rowCount === undefined ? rows.length : result.rowCount });
};

exports.TypeRegistry = TypeRegistry;
exports.nativeType = nativeType;

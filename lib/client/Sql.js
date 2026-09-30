'use strict';

var typedValues = require('../core/TypedValue');

var FRAGMENT = Symbol('NuBloxSQL.SqlFragment');
var IDENTIFIER = Symbol('NuBloxSQL.SqlIdentifier');
var PARAMETER = Symbol('NuBloxSQL.SqlParameter');

function SqlFragment(strings, values) {
  this.strings = strings;
  this.values = values;
  this[FRAGMENT] = true;
  Object.freeze(this.strings);
  Object.freeze(this.values);
  Object.freeze(this);
}

function SqlIdentifier(parts) {
  this.parts = parts;
  this[IDENTIFIER] = true;
  Object.freeze(this.parts);
  Object.freeze(this);
}

function SqlParameter(name, typeSpec) {
  this.name = name;
  this.type = typeSpec === undefined ? null : typedValues.normalizeTypeSpec(typeSpec);
  this[PARAMETER] = true;
  Object.freeze(this);
}

function sql(strings) {
  if (!Array.isArray(strings) || !Object.prototype.hasOwnProperty.call(strings, 'raw')) {
    throw new TypeError('NuBloxSQL sql must be used as a tagged template literal');
  }
  return new SqlFragment(Array.prototype.slice.call(strings), Array.prototype.slice.call(arguments, 1));
}

sql.identifier = function identifier() {
  var parts = Array.prototype.slice.call(arguments);
  if (!parts.length || parts.some(function (part) { return typeof part !== 'string' || part.length === 0; })) {
    throw new TypeError('NuBloxSQL sql.identifier requires one or more non-empty string parts');
  }
  return new SqlIdentifier(parts);
};

sql.parameter = function parameter(name, typeSpec) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('NuBloxSQL sql.parameter requires a non-empty string name');
  }
  return new SqlParameter(name, typeSpec);
};

sql.typed = function typed(value, typeSpec) {
  return typedValues.typed(value, typeSpec);
};

sql.join = function join(fragments, separator) {
  if (!Array.isArray(fragments)) throw new TypeError('NuBloxSQL sql.join requires an array');
  separator = separator === undefined ? ', ' : String(separator);
  if (!fragments.length) return new SqlFragment([''], []);
  var strings = [''];
  var values = [];
  fragments.forEach(function (fragment, index) {
    if (index) strings[strings.length - 1] += separator;
    values.push(fragment);
    strings.push('');
  });
  return new SqlFragment(strings, values);
};

function isFragment(value) {
  return !!(value && value[FRAGMENT] === true);
}

function isIdentifier(value) {
  return !!(value && value[IDENTIFIER] === true);
}

function isParameter(value) {
  return !!(value && value[PARAMETER] === true);
}

function appendPlaceholder(services, state) {
  state.index += 1;
  state.text += services.placeholder(state.index);
}

function compileInto(fragment, services, state) {
  if (!isFragment(fragment)) throw new TypeError('NuBloxSQL expected an sql tagged-template fragment');
  for (var i = 0; i < fragment.strings.length; i++) {
    state.text += fragment.strings[i];
    if (i >= fragment.values.length) continue;
    var value = fragment.values[i];
    if (isIdentifier(value)) {
      state.text += value.parts.map(services.quoteIdentifier).join('.');
    } else if (isFragment(value)) {
      compileInto(value, services, state);
    } else if (isParameter(value)) {
      throw new TypeError('NuBloxSQL sql.parameter() can only be used with prepare()');
    } else {
      appendPlaceholder(services, state);
      state.parameters.push(value);
    }
  }
}

function compilePreparedInto(fragment, services, state) {
  if (!isFragment(fragment)) throw new TypeError('NuBloxSQL expected an sql tagged-template fragment');
  for (var i = 0; i < fragment.strings.length; i++) {
    state.text += fragment.strings[i];
    if (i >= fragment.values.length) continue;
    var value = fragment.values[i];
    if (isIdentifier(value)) {
      state.text += value.parts.map(services.quoteIdentifier).join('.');
    } else if (isFragment(value)) {
      compilePreparedInto(value, services, state);
    } else {
      appendPlaceholder(services, state);
      if (isParameter(value)) state.bindings.push(Object.freeze({ kind: 'parameter', name: value.name, type: value.type }));
      else state.bindings.push(Object.freeze({ kind: 'value', value: value, type: typedValues.isTypedValue(value) ? value.spec : null }));
    }
  }
}

function assertServices(services) {
  if (!services || typeof services.quoteIdentifier !== 'function' || typeof services.placeholder !== 'function') {
    throw new TypeError('NuBloxSQL SQL compilation requires dialect quoteIdentifier and placeholder services');
  }
}

function compile(fragment, services) {
  assertServices(services);
  var state = { text: '', parameters: [], index: 0 };
  compileInto(fragment, services, state);
  return Object.freeze({ text: state.text, parameters: Object.freeze(state.parameters.slice()) });
}

function compilePrepared(fragment, services) {
  assertServices(services);
  var state = { text: '', bindings: [], index: 0 };
  compilePreparedInto(fragment, services, state);
  return Object.freeze({ text: state.text, bindings: Object.freeze(state.bindings.slice()) });
}

exports.sql = sql;
exports.compile = compile;
exports.compilePrepared = compilePrepared;
exports.isFragment = isFragment;
exports.isParameter = isParameter;
exports.SqlFragment = SqlFragment;
exports.SqlIdentifier = SqlIdentifier;
exports.SqlParameter = SqlParameter;

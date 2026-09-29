'use strict';

var FRAGMENT = Symbol('NuBloxSQL.SqlFragment');
var IDENTIFIER = Symbol('NuBloxSQL.SqlIdentifier');

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
    } else {
      state.index += 1;
      state.text += services.placeholder(state.index);
      state.parameters.push(value);
    }
  }
}

function compile(fragment, services) {
  if (!services || typeof services.quoteIdentifier !== 'function' || typeof services.placeholder !== 'function') {
    throw new TypeError('NuBloxSQL SQL compilation requires dialect quoteIdentifier and placeholder services');
  }
  var state = { text: '', parameters: [], index: 0 };
  compileInto(fragment, services, state);
  return Object.freeze({ text: state.text, parameters: Object.freeze(state.parameters.slice()) });
}

exports.sql = sql;
exports.compile = compile;
exports.isFragment = isFragment;
exports.SqlFragment = SqlFragment;
exports.SqlIdentifier = SqlIdentifier;

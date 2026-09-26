'use strict';

var convert = null;

exports.resolve = resolve;

function resolve(config, options) {
  if (options.namedPlaceholders === undefined) {
    options.namedPlaceholders = config.namedPlaceholders;
  }

  if (!options.namedPlaceholders || Array.isArray(options.values)) {
    return options;
  }

  if (convert === null) {
    convert = require('named-placeholders')();
  }

  var unnamed = convert(options.sql, options.values);

  options.sql = unnamed[0];
  options.values = unnamed[1];
  return options;
}

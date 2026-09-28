'use strict';

var Diagnostics = require('diagnostics_channel');

var AttributeChannel = Diagnostics.channel('nublox.mysql.query.attributes');

exports.capture = capture;

function capture(attributes, operation) {
  var captured = cloneAttributes(attributes);

  if (AttributeChannel.hasSubscribers) {
    AttributeChannel.publish({
      attributes : captured,
      operation  : operation || 'query'
    });
  }

  return validateAttributes(captured);
}

function cloneAttributes(attributes) {
  if (attributes === undefined || attributes === null) {
    return {};
  }

  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new TypeError('query attributes must be an object');
  }

  var copy = {};

  Object.keys(attributes).forEach(function (name) {
    copy[name] = attributes[name];
  });

  return copy;
}

function validateAttributes(attributes) {
  Object.keys(attributes).forEach(function (name) {
    if (name.indexOf('\u0000') !== -1) {
      var nameError = new TypeError('query attribute names must not contain NUL');
      nameError.code = 'QUERY_ATTRIBUTE_INVALID_NAME';
      throw nameError;
    }

    if (attributes[name] === undefined) {
      var valueError = new TypeError('query attribute values must not be undefined');
      valueError.code = 'QUERY_ATTRIBUTE_UNDEFINED_VALUE';
      throw valueError;
    }
  });

  return attributes;
}

'use strict';

var Diagnostics = require('diagnostics_channel');
var QueryAttributeCodec = require('./protocol/QueryAttributeCodec');

var AttributeChannel = Diagnostics.channel('nublox.mysql.query.attributes');
var CapturedAttributes = new global.WeakSet();

exports.capture = capture;

function capture(attributes, operation) {
  if (attributes && typeof attributes === 'object' && CapturedAttributes.has(attributes)) {
    return attributes;
  }

  var captured = cloneAttributes(attributes);

  if (AttributeChannel.hasSubscribers) {
    AttributeChannel.publish({
      attributes : captured,
      operation  : operation || 'query'
    });
  }

  validateAttributes(captured);
  CapturedAttributes.add(captured);
  return captured;
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

    QueryAttributeCodec.describe(attributes[name]);
  });
}

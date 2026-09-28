'use strict';

var POLICIES = {
  modern: {
    minVersion: 'TLSv1.2'
  },
  strict: {
    minVersion: 'TLSv1.3'
  }
};

exports.apply = apply;
exports.get = get;

function apply(ssl, policyName) {
  if (policyName === undefined || policyName === null || policyName === false) {
    return {
      name : null,
      ssl  : ssl
    };
  }

  if (typeof policyName !== 'string') {
    throw new TypeError('tlsPolicy must be modern or strict');
  }

  var name = policyName.trim().toLowerCase();
  var policy = POLICIES[name];

  if (!policy) {
    throw new TypeError('tlsPolicy must be modern or strict');
  }

  if (!ssl || typeof ssl !== 'object') {
    throw new TypeError('tlsPolicy requires ssl to be enabled');
  }

  if (ssl.rejectUnauthorized === false) {
    throw new TypeError('tlsPolicy requires certificate verification');
  }

  if (ssl.minVersion && compareVersions(ssl.minVersion, policy.minVersion) < 0) {
    throw new RangeError(
      'tlsPolicy ' + name + ' requires minVersion ' + policy.minVersion + ' or newer'
    );
  }

  if (ssl.maxVersion && compareVersions(ssl.maxVersion, policy.minVersion) < 0) {
    throw new RangeError(
      'tlsPolicy ' + name + ' is incompatible with maxVersion ' + ssl.maxVersion
    );
  }

  ssl.minVersion = ssl.minVersion || policy.minVersion;
  ssl.rejectUnauthorized = true;

  return {
    name : name,
    ssl  : ssl
  };
}

function get(name) {
  var policy = POLICIES[name];
  return policy ? {minVersion: policy.minVersion} : null;
}

function compareVersions(left, right) {
  return versionRank(left) - versionRank(right);
}

function versionRank(value) {
  switch (value) {
    case 'TLSv1':
    case 'TLSv1.0':
      return 10;
    case 'TLSv1.1':
      return 11;
    case 'TLSv1.2':
      return 12;
    case 'TLSv1.3':
      return 13;
    default:
      throw new TypeError('Unsupported TLS version in tlsPolicy configuration: ' + value);
  }
}

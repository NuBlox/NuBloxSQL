'use strict';

var mysql = require('..');

var packageJson = require('../package.json');
if (packageJson.name !== '@nublox/mysql') throw new Error('canonical MySQL package name mismatch');
if (packageJson.private !== false) throw new Error('canonical MySQL package must be publishable');
for (var key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
  if (packageJson[key] && Object.keys(packageJson[key]).length) throw new Error(key + ' must remain empty');
}
if (typeof mysql.createConnection !== 'function') throw new Error('createConnection export missing');
if (typeof mysql.createPool !== 'function') throw new Error('createPool export missing');
console.log('ok - canonical MySQL package contract');

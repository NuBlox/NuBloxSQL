'use strict';

const assert = require('node:assert/strict');
const routerApi = require('../lib/runtime/SqlAdapterRouter');
const connectionUrl = require('../lib/client/ConnectionUrl');
const publicErrors = require('../lib/client/PublicError');
const sql = require('..');

function stub(family) {
  return {
    descriptor: {
      identity: {family},
      services: {
        quoteIdentifier(name) { return '"' + name + '"'; },
        placeholder(index) { return '?' + index; }
      }
    },
    createConnection(config) { return {config}; }
  };
}
const loaded = [];
const drivers = {mysql: stub('mysql'), postgresql: stub('postgresql'),
  sqlite: stub('sqlite'), sqlserver: stub('sqlserver')};
const loaders = Object.fromEntries(Object.keys(drivers).map(name =>
  [name, () => {loaded.push(name);return drivers[name];}]
));
const router = routerApi.create({loaders,connectionUrl,errors:publicErrors});
assert.deepEqual(Object.keys(router.DIALECTS), Object.keys(sql.DIALECTS));
assert.ok(Object.isFrozen(router));
assert.ok(Object.isFrozen(router.DIALECTS));
assert.equal(loaded.length,0,'constructing a router must not load DBMS implementations');
assert.equal(router.normalizeDialect(' PG '),'postgresql');
assert.equal(router.normalizeDialect('mssql'),'sqlserver');
assert.equal(router.normalizeDialect('sql-server'),'sqlserver');
assert.throws(() => router.normalizeDialect(''), /requires a dialect/);
assert.throws(() => router.normalizeDialect('mongodb'), /Unsupported NuBloxSQL dialect/);
assert.equal(loaded.length,0,'normalising a dialect must not load it');

// Mutating the original loader map must not change the closed registry.
loaders.mongodb = () => stub('mongodb');
delete loaders.mysql;
assert.equal(router.normalizeDialect('mysql'),'mysql');
assert.throws(() => router.normalizeDialect('mongodb'), /Unsupported NuBloxSQL dialect/);
assert.throws(() => router.normalizeDialect('toString'), /Unsupported NuBloxSQL dialect/);
assert.equal(loaded.length,0,'injected or removed loaders must not be executed');

const mysql=router.resolveInvocation({dialect:'mysql',host:'db.test',user:'tester'});
assert.equal(mysql.dialect,'mysql');
assert.equal(mysql.config.host,'db.test');
assert.ok(!Object.prototype.hasOwnProperty.call(mysql.config,'dialect'));
assert.strictEqual(mysql.adapter,drivers.mysql);
assert.deepEqual(loaded,['mysql']);
assert.strictEqual(router.loadAdapter('mysql'),drivers.mysql);
assert.deepEqual(loaded,['mysql'],'router must cache the loaded native adapter');

const pg=router.resolveInvocation({
  url:'postgres://test:secret@db.test:5432/catalog?sslmode=require',
  database:'override'
});
assert.equal(pg.dialect,'postgresql');
assert.equal(pg.config.database,'override');
assert.equal(pg.config.ssl,'require');
assert.equal(pg.config.user,'test');
assert.equal(pg.config.password,'secret');
assert.equal(pg.config.host,'db.test');
assert.equal(pg.config.port,5432);
assert.equal(pg.config.url,undefined);
assert.equal(pg.adapter,drivers.postgresql);

const pgUrl=router.resolveInvocation('postgresql://test:pw@db.test/default',{
  database:'custom', connectionLimit:7
});
assert.equal(pgUrl.config.database,'custom');
assert.equal(pgUrl.config.connectionLimit,7);
assert.deepEqual(loaded,['mysql','postgresql']);
const sqlite=router.resolveInvocation('sqlite::memory:');
assert.equal(sqlite.dialect,'sqlite');
assert.equal(sqlite.config.filename,':memory:');
assert.equal(sqlite.adapter,drivers.sqlite);

assert.throws(() => router.resolveInvocation({
  dialect:'mysql',url:'postgresql://test:pw@db.test/db'
}), /does not match explicit dialect/);
assert.throws(() => router.resolveInvocation({dialect:'redis'}),/Unsupported NuBloxSQL dialect/);
assert.throws(() => router.resolveInvocation({dialect:'mongo'}),/Unsupported NuBloxSQL dialect/);
assert.throws(() => router.resolveInvocation('oracle://tester:secret@db.test/service'),
  /Unsupported NuBloxSQL connection URL scheme/);
assert.throws(() => router.resolveInvocation([]), /connection configuration must be an object/);
assert.equal(loaded.includes('sqlserver'),false,'unsupported routing must not load other adapters');

let attempts=0;
const retryRouter=routerApi.create({
  loaders:{mysql:() => {
    attempts++;
    if(attempts===1)return {descriptor:{identity:{family:'mysql'}}};
    return drivers.mysql;
  }},
  connectionUrl,errors:publicErrors
});
assert.throws(() => retryRouter.loadAdapter('mysql'), /createConnection/);
assert.strictEqual(retryRouter.loadAdapter('mysql'),drivers.mysql);
assert.equal(attempts,2,'invalid native adapters must never be cached');

assert.throws(() => routerApi.create(null), /requires options/);
assert.throws(() => routerApi.create({
  loaders:{},connectionUrl,errors:publicErrors
}), /requires native loaders/);
assert.throws(() => routerApi.create({
  loaders:{mysql:42},connectionUrl,errors:publicErrors
}), /loader requires/);
assert.throws(() => routerApi.create({
  loaders:{mysql:() => drivers.mysql},connectionUrl:{},errors:publicErrors
}), /requires loaders, connection URLs and public errors/);

// This is a routing refactor, not a new public runtime type.
assert.strictEqual(typeof sql.createClient,'function');
assert.equal(sql.databaseTechnologyRegistry.inspect('mongodb').canConnect,false);
assert.equal(sql.cloudDatabaseRegistry.report().counts.cloudQualified,0);
console.log('NuBloxSQL lazy SQL adapter router and fail-closed routing: PASS');

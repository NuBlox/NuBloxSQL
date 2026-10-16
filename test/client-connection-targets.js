'use strict';

// Connection-target selection and portable pool-option translation remain
// stable across SQL runtimes and externally supplied transactions.
const assert = require('node:assert/strict');
const clientApi = require('../lib/client/Client');
const targets = require('../lib/client/runtime/ConnectionTargets');

assert.ok(Object.isFrozen(targets));
assert.deepEqual(targets.copyWithoutClientKeys({
  dialect:'postgresql',pool:{max:4},host:'db.example',port:5432,user:'read'
}),{host:'db.example',port:5432,user:'read'});
assert.deepEqual(targets.copyWithoutClientKeys(null),{});
assert.deepEqual(targets.createPoolConfig({dialect:'mysql',pool:true,host:'db'}),{host:'db'});
assert.deepEqual(targets.createPoolConfig({dialect:'mysql',pool:false,host:'db'}),{host:'db'});
assert.deepEqual(targets.createPoolConfig({
  dialect:'mysql',pool:{max:7,waitForConnections:true},connectionLimit:2
}),{connectionLimit:7,waitForConnections:true});
assert.deepEqual(targets.createPoolConfig({
  dialect:'postgresql',pool:{max:5,idleTimeoutMillis:1000},host:'db'
}),{host:'db',connectionLimit:5,idleTimeoutMillis:1000});
for (const invalid of [[],3,'max=5']) {
  assert.throws(()=>targets.createPoolConfig({pool:invalid}),/pool must be/);
}

const options={
  dialect:'mysql',pool:{max:3,waitForConnections:true},
  host:'mysql.example',user:'tester',password:'do-not-log'
};
const snapshot=structuredClone(options);
const invocations=[];
const pool={label:'pooled'};
const direct={label:'direct'};
const adapter={
  descriptor:{capabilities:{}},
  createPool(config){invocations.push({kind:'pool',config});return pool;},
  createConnection(config){invocations.push({kind:'connection',config});return direct;}
};
const chosen=targets.createTarget(adapter,options);
assert.strictEqual(chosen.target,pool);
assert.strictEqual(chosen.isPool,true);
assert.deepEqual(invocations[0],{kind:'pool',config:{
  host:'mysql.example',user:'tester',password:'do-not-log',
  connectionLimit:3,waitForConnections:true
}});
assert.deepEqual(options,snapshot,'pool selection must not mutate client configuration');
const pooledClient=new clientApi.Client(adapter,'mysql',options);
assert.strictEqual(pooledClient.native,pool);
assert.strictEqual(pooledClient._isPool,true);
assert.strictEqual(pooledClient.config,options);

const directOptions={...options,pool:false};
const conn=targets.createTarget(adapter,directOptions);
assert.strictEqual(conn.target,direct);
assert.strictEqual(conn.isPool,false);
assert.deepEqual(invocations[2],{kind:'connection',config:{
  host:'mysql.example',user:'tester',password:'do-not-log'
}});
const directClient=new clientApi.Client(adapter,'mysql',directOptions);
assert.strictEqual(directClient.native,direct);
assert.strictEqual(directClient._isPool,false);
assert.equal(invocations.length,4);
assert.deepEqual(invocations[3],invocations[2]);

const connectionOnly={
  descriptor:{capabilities:{}},
  createConnection(config){invocations.push({kind:'connection-only',config});return direct;}
};
const sqliteClient=new clientApi.Client(connectionOnly,'sqlite',{
  dialect:'sqlite',filename:':memory:',pool:true
});
assert.strictEqual(sqliteClient.native,direct);
assert.strictEqual(sqliteClient._isPool,false);
assert.deepEqual(invocations[4],{kind:'connection-only',config:{filename:':memory:'}});

const transactionConnection={label:'external'};
const before=invocations.length;
const tx=new clientApi.Client(adapter,'mysql',options,transactionConnection,false);
assert.strictEqual(tx.native,transactionConnection);
assert.strictEqual(tx._isPool,false);
assert.strictEqual(tx._ownsTarget,false);
assert.equal(invocations.length,before,'external transaction target must never create another pool');

const error=new Error('native connection rejection');
assert.throws(()=>targets.createTarget({
  createPool(){throw error;},
  createConnection(){throw new Error('wrong branch');}
},options),e=>e===error);

console.log('NuBloxSQL SQL client connection target and pool option boundaries: PASS');

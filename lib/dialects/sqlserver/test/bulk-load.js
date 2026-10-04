'use strict';

var assert = require('assert');
var sqlserver = require('..');
var BulkLoad = require('../lib/BulkLoad');
var Rpc = require('../lib/Rpc');
var TYPES = sqlserver.ResultStream.TYPES;

function metadata() {
  return [
    { name:'id',userType:0,flags:0x0004,nullable:false,type:TYPES.INT4,maxLength:null,collation:null,precision:null,scale:null },
    { name:'name',userType:0,flags:0x0005,nullable:true,type:TYPES.NVARCHAR,maxLength:8000,collation:Rpc.DEFAULT_COLLATION,precision:null,scale:null },
    { name:'active',userType:0,flags:0x0005,nullable:true,type:TYPES.BITN,maxLength:1,collation:null,precision:null,scale:null },
    { name:'score',userType:0,flags:0x0005,nullable:true,type:TYPES.FLOATN,maxLength:8,collation:null,precision:null,scale:null },
    { name:'payload',userType:0,flags:0x0005,nullable:true,type:TYPES.BIGVARBINARY,maxLength:8000,collation:null,precision:null,scale:null }
  ];
}

async function main() {
  var rows = [
    { id: 1, name: 'Ada', active: true, score: 1.5, payload: Buffer.from([0x01, 0x02]) },
    { id: 2, name: 'Grace', active: false, score: 2.75, payload: null },
    { id: 3, name: null, active: true, score: 3, payload: Buffer.from([0xaa]) }
  ];

  assert.strictEqual(
    BulkLoad.metadataQuery(['dbo','target'],['id','name']),
    'SELECT TOP (0) [id], [name] FROM [dbo].[target]'
  );

  var plan = BulkLoad.build(['dbo', 'target'], ['id', 'name', 'active', 'score', 'payload'], rows, metadata());
  assert.ok(plan);
  assert.strictEqual(plan.statement, 'INSERT BULK [dbo].[target] ([id] int, [name] nvarchar(4000), [active] bit, [score] float, [payload] varbinary(8000))');
  assert.strictEqual(plan.rowCount, 3);

  var parsed = sqlserver.ResultStream.parse(plan.payload);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.rows.length, 3);
  assert.strictEqual(parsed.rows[0].id, 1);
  assert.strictEqual(parsed.rows[0].name, 'Ada');
  assert.strictEqual(parsed.rows[0].active, true);
  assert.strictEqual(parsed.rows[0].score, 1.5);
  assert.deepStrictEqual(parsed.rows[0].payload, Buffer.from([0x01, 0x02]));
  assert.strictEqual(parsed.rows[1].payload, null);
  assert.strictEqual(parsed.rows[2].name, null);

  var maxMetadata=[{name:'value',userType:0,flags:0x0005,nullable:true,type:TYPES.NVARCHAR,maxLength:0xffff,collation:Rpc.DEFAULT_COLLATION,precision:null,scale:null}];
  var large = 'x'.repeat(5000);
  var maxPlan = BulkLoad.build(['dbo', 'large_target'], ['value'], [{ value: large }, { value: null }], maxMetadata);
  assert.ok(maxPlan);
  assert.match(maxPlan.statement, /nvarchar\(max\)/);
  assert.strictEqual(sqlserver.ResultStream.parse(maxPlan.payload).rows[0].value, large);

  var unsupportedMetadata=[{name:'value',userType:0,flags:0x0005,nullable:true,type:TYPES.NVARCHAR,maxLength:8000,collation:Rpc.DEFAULT_COLLATION,precision:null,scale:null}];
  assert.strictEqual(BulkLoad.build(['dbo', 'target'], ['value'], [{ value: { nested: true } }], unsupportedMetadata), null);
  assert.throws(function () { BulkLoad.build([], ['id'], [{ id: 1 }], metadata().slice(0,1)); }, /table/);
  assert.throws(function () { BulkLoad.build(['dbo', 'target'], [], [{ id: 1 }], []); }, /columns/);

  var fake = Object.create(sqlserver.Connection.prototype);
  var calls = [];
  fake.query = async function (statement, options) {
    calls.push({ type: 'query', statement: statement, options: options });
    if (/^SELECT TOP \(0\)/.test(statement)) {
      return { success:true, columns:metadata().slice(0,2), rows:[] };
    }
    return { success: true, columns:[], rows:[] };
  };
  fake._executeRequest = async function (packetType, payload, options) {
    calls.push({ type: 'bulk', packetType: packetType, payload: payload, options: options });
    return { success: true };
  };

  var result = await fake.bulkInsert(['dbo', 'target'], ['id', 'name'], [
    { id: 10, name: 'native' },
    { id: 11, name: null }
  ], { timeout: 1000 });

  assert.strictEqual(result.affectedRows, 2n);
  assert.strictEqual(calls.length, 3);
  assert.match(calls[0].statement, /^SELECT TOP \(0\)/);
  assert.match(calls[1].statement, /^INSERT BULK /);
  assert.strictEqual(calls[2].packetType, sqlserver.TdsPacket.PACKET_TYPES.BULK_LOAD);
  assert.deepStrictEqual(sqlserver.ResultStream.parse(calls[2].payload).rows, [
    { id: 10, name: 'native' },
    { id: 11, name: null }
  ]);

  var unsupportedFake=Object.create(sqlserver.Connection.prototype);
  unsupportedFake.query=async function(statement){
    return /^SELECT TOP \(0\)/.test(statement)
      ? {success:true,columns:unsupportedMetadata,rows:[]}
      : {success:true,columns:[],rows:[]};
  };
  unsupportedFake._executeRequest=async function(){throw new Error('bulk request should not be sent');};
  var unsupported = await unsupportedFake.bulkInsert(['dbo', 'target'], ['value'], [{ value: { nested: true } }]);
  assert.strictEqual(unsupported, null);

  assert.strictEqual(sqlserver.capabilities.nativeBulkLoad, true);
  assert.strictEqual(typeof sqlserver.Pool.prototype.bulkInsert, 'function');

  console.log('NuBloxSQL SQL Server TDS bulk-load contract passed');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

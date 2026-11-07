import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MysqlMaterializationBudget} from '../dist/vendors/mysql/materialization.js';
import {MAX_MATERIALIZED_RESULT_BYTES,MAX_PACKET_BYTES} from '../dist/core/resources.js';

const col=(name)=>({
  name,schema:'',table:'',originalName:'',originalTable:'',
  charset:45,length:1,type:1,flags:0,decimals:0,unsigned:false
});

test('materialized result budget is separate from the 32 MiB wire limit',()=>{
  assert.equal(MAX_MATERIALIZED_RESULT_BYTES,2*MAX_PACKET_BYTES);
  const budget=new MysqlMaterializationBudget();
  budget.columns([col('first'),col('second')],['first','second']);
  budget.beforeRow(2);
  budget.decoded([5n,'é 🚀']);
  budget.beforeRow(2);
  budget.decoded([Buffer.from([0,255,128]),null]);
  assert.ok(budget instanceof MysqlMaterializationBudget);
});

test('many narrow wire rows cannot produce unbounded wide JS objects',()=>{
  const budget=new MysqlMaterializationBudget();
  const rowEstimate=192+64*4096;
  const allowed=Math.floor(MAX_MATERIALIZED_RESULT_BYTES/rowEstimate);
  for(let i=0;i<allowed;i++)budget.beforeRow(4096);
  assert.throws(()=>budget.beforeRow(4096),
    error=>error.code==='RESOURCE_LIMIT'&&/materialized result/.test(error.message));
});

test('decoded strings and retained binary data count beyond row object overhead',()=>{
  const budget=new MysqlMaterializationBudget();
  const longText='🎯 café'.repeat(500);
  const raw=Buffer.alloc(1024,0x55);
  budget.beforeRow(3);
  budget.decoded([longText,raw,123n]);
  // The budget includes UTF-16 code units, buffer payload and bigint costs.
  // Repeated calls must eventually exhaust it independently of wire bytes.
  const large='x'.repeat(100_000);
  const rounds=Math.floor(MAX_MATERIALIZED_RESULT_BYTES/(large.length*2));
  for(let i=0;i<rounds;i++)budget.decoded([large]);
  assert.throws(()=>budget.decoded([large]),
    error=>error.code==='RESOURCE_LIMIT');
});

test('calibrated row and column charges are deterministic and bounded',()=>{
  const budget=new MysqlMaterializationBudget();
  // A fixed row charge plus 64 bytes for each positional cell and named
  // property, before text/Buffer/bigint charges are added.
  budget.beforeRow(0);
  assert.equal(budget.estimatedBytes,192);
  budget.beforeRow(8);
  assert.equal(budget.estimatedBytes,192+(192+64*8));
  budget.decoded([123n,'Hi',Buffer.from([0,1,2])]);
  assert.equal(budget.estimatedBytes,
    192+(192+64*8)+16+2*2+64+3);
});

test('calibration prevents wide all-NULL rows escaping the estimated budget',()=>{
  const budget=new MysqlMaterializationBudget();
  const estimate=192+64*64;
  const allowed=Math.floor(MAX_MATERIALIZED_RESULT_BYTES/estimate);
  for(let i=0;i<allowed;i++)budget.beforeRow(64);
  assert.throws(()=>budget.beforeRow(64),
    error=>error.code==='RESOURCE_LIMIT');
});

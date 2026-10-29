import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPublicExports,validatePublicApi} from './api-contract-core.mjs';

const original=`export {connectDatabase} from './core/connection.js';
export {createDatabasePool} from './core/connection.js';
export {DriverError} from './core/errors.js';
export type {MysqlTarget,BindValue} from './core/contracts.js';`;
const exportsLocked=[
  {name:'BindValue',kind:'type',from:'./core/contracts.js',imported:'BindValue'},
  {name:'connectDatabase',kind:'value',from:'./core/connection.js',imported:'connectDatabase'},
  {name:'createDatabasePool',kind:'value',from:'./core/connection.js',imported:'createDatabasePool'},
  {name:'DriverError',kind:'value',from:'./core/errors.js',imported:'DriverError'},
  {name:'MysqlTarget',kind:'type',from:'./core/contracts.js',imported:'MysqlTarget'}
].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const baseline={schemaVersion:1,package:'@nublox/driver',
  releaseLine:'0.1.0-dev.0',policy:'exact-reviewed-public-exports',
  exports:exportsLocked};
const manifest={name:'@nublox/driver',version:'0.1.0-dev.0',
  exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}}};
const check=(source=original,locked=baseline,pkg=manifest)=>
  validatePublicApi({source,baseline:locked,manifest:pkg});

test('named root exports and type-only boundaries match the reviewed baseline',()=>{
  assert.deepEqual(extractPublicExports(original),exportsLocked);
  assert.deepEqual(check(),{
    schemaVersion:1,kind:'public-api-contract',status:'passed',
    package:'@nublox/driver',version:'0.1.0-dev.0',
    exports:5,typeExports:2,runtimeExports:3
  });
});

test('accidental exports, hidden subpaths and value/type regressions are blocked',()=>{
  for(const source of [
    original.replace('export type {','export {'),
    original+'\nexport {experimental} from \'./core/experimental.js\';',
    original+'\nexport * from \'./core/connection.js\';',
    original+'\nexport default 3;',
    original+'\nexport const bypass = 4;',
    original+'\nexport {connectDatabase as client} from \'./core/connection.js\';',
    original.replace("from './core/errors.js'","from './core/connection.js'"),
    original+'\nexport {DriverError} from \'./core/errors.js\';',
    'export type {Bad} from \'external-module\';'
  ])assert.throws(()=>check(source));
  assert.throws(()=>check(original,baseline,{
    ...manifest,exports:{...manifest.exports,'./internal':'./dist/internal.js'}
  }));
});

test('version changes and malformed baseline require explicit contract review',()=>{
  assert.throws(()=>check(original,baseline,{...manifest,version:'0.2.0-dev.0'}));
  assert.throws(()=>check(original,{...baseline,policy:'skip-validation'}));
  assert.throws(()=>check(original,{...baseline,exports:[]}));
  assert.throws(()=>check('export type {Broken from ./where;'));
});

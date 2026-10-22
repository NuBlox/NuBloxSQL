import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectManifest,inspectPacklist,inspectRuntimeImports} from './verify-core.mjs';

const validManifest={
  name:'@nublox/driver',version:'0.1.0-dev.0',type:'module',
  license:'SEE LICENSE IN LICENSE',engines:{node:'>=22'},
  main:'./dist/index.js',types:'./dist/index.d.ts',
  exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}}
};
const validFiles=[
  'LICENSE','README.md','package.json',
  'dist/index.js','dist/index.d.ts',
  'dist/core/errors.js','dist/core/errors.d.ts'
].map(path=>({path,size:128}));

test('release preflight accepts an intentionally restricted native-driver package',()=>{
  inspectManifest(validManifest);
  assert.deepEqual(inspectPacklist(validFiles),{fileCount:7,totalBytes:896});
  inspectRuntimeImports(
    "import {Socket} from 'node:net'; import {fail} from './core/errors.js'; await import('../core/next.js');",
    'dist/index.js'
  );
});

test('release preflight rejects missing proprietary licence and unsafe contents',()=>{
  for(const path of ['LICENSE','dist/index.js','dist/index.d.ts']){
    assert.throws(()=>inspectPacklist(validFiles.filter(f=>f.path!==path)),
      /Required package file missing/);
  }
  for(const path of [
    '.env','certs/mysql.key','dist/secrets.pem','dist/secret.json',
    'dist/index.js.map','src/index.ts','tests/fixture.js',
    'dist/../../outside.js','node_modules/mysql/index.js'
  ]){
    assert.throws(()=>inspectPacklist([...validFiles,{path,size:2}]),
      /Unexpected private/);
  }
  assert.throws(()=>inspectPacklist([...validFiles,{path:'dist/giant.js',size:2*1024*1024+1}]),
    /exceeds the bounded package limit/);
  assert.throws(()=>inspectPacklist([...validFiles,validFiles[0]]),
    /Duplicate npm pack path/);
});
test('release preflight prohibits third-party runtime modules and hidden npm scripts',()=>{
  inspectRuntimeImports("import 'node:crypto';");
  for(const source of [
    "import mysql from 'mysql2';",
    "export {dialect} from '@other/driver';",
    "const sqlite = await import('better-sqlite3');",
    "const x = require('mysql');"
  ])assert.throws(()=>inspectRuntimeImports(source),/third-party runtime import/);
  for(const change of [
    {license:'SEE LICENSE IN ../../LICENSE'},
    {version:'1.0.0'},
    {dependencies:{mysql:'*'}},
    {optionalDependencies:{'spy-module':'1.0.0'}},
    {scripts:{postinstall:'node setup.js'}},
    {main:'./src/index.ts'}
  ])assert.throws(()=>inspectManifest({...validManifest,...change}));
});

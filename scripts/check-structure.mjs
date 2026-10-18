#!/usr/bin/env node
// Boundaries for real NuBloxSQL modules; never scaffold empty product packages.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const exists=p=>existsSync(join(root,p));
const read=p=>readFileSync(join(root,p),'utf8');
const required=[
 'package.json','package-lock.json',
 'packages/driver/package.json','packages/driver/src/index.ts',
 'packages/driver/src/operations/inspect-database.ts',
 'packages/driver/src/adapters/postgresql/wire.ts',
 'packages/driver/src/adapters/postgresql/catalog.ts',
 'packages/driver/src/adapters/sqlite/connection.ts',
 'packages/driver/src/adapters/mysql/protocol.ts',
 'packages/driver/src/client.ts',
 'apps/shell/package.json','apps/shell/src/cli.ts',
 'tests/unit/inventory-contract.test.mjs','tests/unit/shell-interface.test.mjs',
 'tests/unit/mysql-protocol.test.mjs',
 'tests/integration/postgresql/inventory.test.mjs',
 'tests/integration/postgresql/resource-governance.test.mjs',
 'tests/integration/postgresql/verified-tls.test.mjs',
 'tests/fixtures/postgresql/start-tls.sh'
];
for(const p of required)assert.ok(exists(p),'Missing implemented module or test: '+p);
const obsolete=[
 'packages/driver/src/postgresql','tests/live-postgres.test.mjs',
 'tests/live-postgres-governance.test.mjs','tests/live-postgres-tls.test.mjs',
 'tests/inventory-contract.test.mjs','tests/shell-interface.test.mjs',
 'tests/fixtures/start-postgresql-tls.sh'
];
for(const p of obsolete)assert.ok(!exists(p),'Stale source/test path: '+p);

const rootPackage=JSON.parse(read('package.json'));
const driver=JSON.parse(read('packages/driver/package.json'));
const shell=JSON.parse(read('apps/shell/package.json'));
assert.deepEqual(rootPackage.workspaces,['packages/*','apps/*']);
assert.equal(rootPackage.private,true);
assert.equal(driver.private,true);
assert.equal(shell.private,true);
assert.equal(driver.name,'@nubloxsql/driver');
assert.equal(shell.name,'@nubloxsql/shell');
assert.equal(Object.keys(driver.dependencies??{}).length,0,'Native Driver must not wrap DBMS libraries');
assert.deepEqual(shell.dependencies,{'@nubloxsql/driver':driver.version},
 'Shell must depend on the public Driver and no other DBMS runtime');
const index=read('packages/driver/src/index.ts');
assert.match(index,/from ['"]\.\/operations\/inspect-database\.js['"]/);
assert.doesNotMatch(index,/from ['"]\.\/adapters\//,
 'Public Driver entry point may not export adapter internals');
const operation=read('packages/driver/src/operations/inspect-database.ts');
assert.match(operation,/from ['"]\.\.\/adapters\/postgresql\/catalog\.js['"]/);
assert.doesNotMatch(operation,/pg_catalog|pg_database|current_setting\(/,
 'Vendor catalogue SQL must stay inside adapter');
const catalog=read('packages/driver/src/adapters/postgresql/catalog.ts');
assert.match(catalog,/pg_catalog\.pg_database/);
const cli=read('apps/shell/src/cli.ts');
assert.match(cli,/from ['"]@nubloxsql\/driver['"]/);
assert.doesNotMatch(cli,/from ['"](?:@nubloxsql\/driver\/|.*\/(?:adapters|packages\/driver|postgresql)\/)/,
 'Shell cannot reach into private native adapters');

const codeFiles=dir=> {
 if(!exists(dir))return [];
 const files=[];
 const visit=(p)=>{
  for(const e of readdirSync(join(root,p),{withFileTypes:true})){
   const path=p+'/'+e.name;
   if(e.isDirectory())visit(path);
   if(e.isFile())files.push(path);
  }
 };
 visit(dir);
 return files;
};
for(const path of codeFiles('packages/driver/src/adapters')){
 if(!path.endsWith('.ts'))continue;
 const source=read(path);
 assert.doesNotMatch(source,/from ['"][^'"]*(?:apps\/shell|\/operations\/)/,
  'Adapter must not depend on professional operations: '+path);
 assert.doesNotMatch(source,/from ['"](pg|mysql2|tedious|mongodb|redis)['"]/,
  'Third-party database client imported in native adapter: '+path);
}
for(const dir of ['packages','apps']){
 for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const path=dir+'/'+entry.name;
  assert.ok(exists(path+'/package.json'),'Workspace is missing package.json: '+path);
  assert.ok(codeFiles(path+'/src').some(p=>p.endsWith('.ts')||p.endsWith('.svelte')),
   'Empty future product placeholder is forbidden: '+path);
 }
}
for(const path of codeFiles('tests/unit')){
 if(path.endsWith('.test.mjs'))
  assert.doesNotMatch(read(path),/NUBLOXSQL_CI_ADMIN_PASSWORD.*throw/,
   'Unit tests cannot depend on live DBMS: '+path);
}
const ci=read('.github/workflows/build.yml');
const scripts=JSON.stringify(rootPackage.scripts);
assert.ok(scripts.includes('tests/unit/*.test.mjs'));
assert.match(ci,/npm run check:structure/);
assert.match(ci,/tests\/integration\/postgresql\/verified-tls\.test\.mjs/);
assert.ok(!exists('lib')&&!exists('index.js'),
 'Legacy implementation must live on protected archive, not main');
console.log('NuBloxSQL implemented source, workspace and test boundaries: PASS');

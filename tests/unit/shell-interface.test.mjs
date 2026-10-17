import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const cli=resolve('apps/shell/dist/cli.js');
test('Shell exposes bounded inspection help',()=>{
 const r=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
 assert.equal(r.status,0);
 assert.match(r.stdout,/shell inspect --profile ALIAS --format json --output PATH/);
});
test('Shell rejects unsupported commands without DB access',()=>{
 const r=spawnSync(process.execPath,[cli,'shell','delete'],{encoding:'utf8'});
 assert.equal(r.status,1);
 assert.match(r.stderr,/INVALID_INPUT/);
});
test('Shell requires explicit authorized profile alias and output path',()=>{
 const r=spawnSync(process.execPath,[cli,'shell','inspect','--profile','not-authorized','--format','json','--output','/tmp/not-created.json'],{encoding:'utf8',env:{...process.env,NUBLOXSQL_PROFILE_ALIAS:'local-test'}});
 assert.equal(r.status,1);
 assert.match(r.stderr,/INVALID_INPUT/);
});

test('Shell does not silently downgrade missing transport security',()=>{
 const env={...process.env,NUBLOXSQL_PROFILE_ALIAS:'local-test',NUBLOXSQL_PG_PASSWORD:'disposable-test-only'};
 delete env.NUBLOXSQL_PG_SECURITY;
 const r=spawnSync(process.execPath,[cli,'shell','inspect','--profile','local-test','--format','json','--output','/tmp/not-created.json'],{encoding:'utf8',env});
 assert.equal(r.status,1);
 assert.match(r.stderr,/TLS_UNVERIFIED/);
});

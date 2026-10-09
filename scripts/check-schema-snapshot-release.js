'use strict';

var assert=require('assert');
var childProcess=require('child_process');
var fs=require('fs');
var os=require('os');
var path=require('path');
var root=path.resolve(__dirname,'..');
var npm=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options){
  return childProcess.execFileSync(command,args,Object.assign({cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']},options||{}));
}

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-schema-snapshot-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-schema-snapshot-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.SCHEMA_SNAPSHOT_SCHEMA_VERSION,1);",
    "const input={vocabularyVersion:1,dialect:'postgresql',scope:{},databases:[],schemas:[],tables:[]};",
    "const snapshot=sql.buildSchemaSnapshot(input);",
    "assert.strictEqual(typeof snapshot.semanticHash,'string');",
    "assert.strictEqual(snapshot.semanticHash.length,64);",
    "assert.strictEqual(sql.schemaFingerprint(snapshot),snapshot.semanticHash);",
    "assert.strictEqual(sql.schemasEquivalent(snapshot,sql.buildSchemaSnapshot(input)),true);"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { CanonicalSchemaSnapshot, SchemaSnapshotTable } from 'nubloxsql';",
    "const version:1=sql.SCHEMA_SNAPSHOT_SCHEMA_VERSION;",
    "const snapshot:CanonicalSchemaSnapshot=sql.buildSchemaSnapshot({vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[],schemas:[],tables:[]});",
    "const tables:readonly SchemaSnapshotTable[]=snapshot.tables;",
    "const hash:string=sql.schemaFingerprint(snapshot);",
    "void version; void tables; void hash;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed canonical schema snapshot qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}

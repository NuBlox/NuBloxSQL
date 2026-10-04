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

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-type-semantics-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-type-semantics-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.TYPE_SEMANTICS_SCHEMA_VERSION,1);",
    "const source=sql.canonicalType('postgresql','numeric(26,6)');",
    "assert.strictEqual(source.family,'decimal');",
    "const target=sql.nativeTypeMapping('sqlserver',source);",
    "assert.strictEqual(target.decision,'native-equivalent');",
    "assert.strictEqual(target.nativeType,'DECIMAL(26,6)');",
    "const uuid=sql.canonicalTypeFromPortableSpec('uuid');",
    "assert.strictEqual(uuid.family,'uuid');"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { CanonicalTypeDescriptor, TypeMappingResult, TypeCompatibilityResult } from 'nubloxsql';",
    "const version:1=sql.TYPE_SEMANTICS_SCHEMA_VERSION;",
    "const canonical:CanonicalTypeDescriptor=sql.canonicalTypeFromPortableSpec({type:'decimal',precision:20,scale:4});",
    "const mapping:TypeMappingResult=sql.nativeTypeMapping('mysql',canonical);",
    "const compatibility:TypeCompatibilityResult=sql.typeCompatibility('postgresql','mysql','uuid');",
    "void version; void mapping; void compatibility;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed canonical type semantics qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}

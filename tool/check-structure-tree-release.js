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

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-structure-tree-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-structure-tree-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.STRUCTURE_TREE_SCHEMA_VERSION,2);",
    "const tree=sql.buildStructureTree({vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[{kind:'database',name:'main',native:{}}],schemas:[{kind:'schema',database:'main',name:'main',native:{}}],tables:[{kind:'table',database:'main',schema:'main',name:'users',columns:[],indexes:[],foreignKeys:[],constraints:[],native:{}}]});",
    "assert.strictEqual(tree.summary.tables,1);",
    "assert.strictEqual(tree.databases[0].children[0].children[0].name,'users');",\n    "assert.ok(tree.databases[0].children[0].children[0].id.startsWith('nubloxsql://'));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { DatabaseStructureTree, StructureTreeNode } from 'nubloxsql';",
    "const version:2=sql.STRUCTURE_TREE_SCHEMA_VERSION;",
    "const tree:DatabaseStructureTree=sql.buildStructureTree({vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[],schemas:[],tables:[]});",
    "const roots:readonly StructureTreeNode[]=tree.databases;",
    "void version; void roots;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed database structure tree qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}

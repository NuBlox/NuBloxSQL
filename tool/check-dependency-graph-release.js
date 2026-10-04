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

var temp=fs.mkdtempSync(path.join(os.tmpdir(),'nubloxsql-dependency-graph-'));
var tarball=null;
try{
  tarball=run(npm,['pack','--silent','--ignore-scripts']).trim().split(/\r?\n/).pop();
  var tarballPath=path.join(root,tarball);
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'nubloxsql-dependency-graph-smoke',private:true}));
  run(npm,['install',tarballPath,'--ignore-scripts','--no-audit','--no-fund'],{cwd:temp});

  var smoke=[
    "const assert=require('assert');",
    "const sql=require('nubloxsql');",
    "assert.strictEqual(sql.OBJECT_IDENTITY_SCHEMA_VERSION,1);",
    "assert.strictEqual(sql.DEPENDENCY_GRAPH_SCHEMA_VERSION,1);",
    "const snapshot={vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[{kind:'database',name:'main',native:{}}],schemas:[{kind:'schema',database:'main',name:'main',native:{}}],tables:[{kind:'table',database:'main',schema:'main',name:'parent',columns:[{kind:'column',database:'main',schema:'main',table:'parent',name:'id',ordinal:1,dataType:'integer',nativeType:'INTEGER',nullability:'not-null',default:null,primaryKey:true,identity:true,generated:{enabled:false,kind:null,expression:null},native:{}}],indexes:[],foreignKeys:[],constraints:[],native:{}},{kind:'table',database:'main',schema:'main',name:'child',columns:[{kind:'column',database:'main',schema:'main',table:'child',name:'parent_id',ordinal:1,dataType:'integer',nativeType:'INTEGER',nullability:'not-null',default:null,primaryKey:false,identity:false,generated:{enabled:false,kind:null,expression:null},native:{}}],indexes:[],foreignKeys:[{kind:'foreign-key',database:'main',schema:'main',table:'child',name:null,columns:['parent_id'],referencedDatabase:'main',referencedSchema:'main',referencedTable:'parent',referencedColumns:['id'],onUpdate:null,onDelete:null,match:null,deferrable:null,initiallyDeferred:null,native:{}}],constraints:[],native:{}}]};",
    "const graph=sql.buildDependencyGraph(snapshot);",
    "const parent=sql.objectId('table',{database:'main',schema:'main',name:'parent'},{dialect:'sqlite'});",
    "const child=sql.objectId('table',{database:'main',schema:'main',name:'child'},{dialect:'sqlite'});",
    "assert(graph.edges.some(e=>e.from===child&&e.to===parent&&e.relation==='references'));",
    "assert(sql.graphDependents(graph,parent,{transitive:false,relations:['references']}).some(n=>n.id===child));"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.js'),smoke);
  run(process.execPath,['smoke.js'],{cwd:temp});

  run(npm,['install','--no-save','--ignore-scripts','--no-audit','--no-fund','typescript@5.9.3','@types/node@22'],{cwd:temp});
  var ts=[
    "import sql = require('nubloxsql');",
    "import type { DatabaseDependencyGraph, DatabaseObjectIdentity, DependencyImpact } from 'nubloxsql';",
    "const id:string=sql.objectId('table',{name:'users'},{dialect:'sqlite',database:'main',schema:'main'});",
    "const parsed:DatabaseObjectIdentity=sql.parseObjectId(id);",
    "const graph:DatabaseDependencyGraph=sql.buildDependencyGraph({vocabularyVersion:1,dialect:'sqlite',scope:{},databases:[],schemas:[],tables:[]});",
    "const impact:DependencyImpact=sql.impactAnalysis(graph,id);",
    "void parsed; void impact;"
  ].join('\n');
  fs.writeFileSync(path.join(temp,'smoke.ts'),ts);
  fs.writeFileSync(path.join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'commonjs',target:'ES2022',moduleResolution:'node',esModuleInterop:true,skipLibCheck:false},files:['smoke.ts']}));
  var tsc=path.join(temp,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
  run(tsc,['-p','tsconfig.json'],{cwd:temp});

  console.log('NuBloxSQL packed object identity and dependency graph qualification: PASS');
}finally{
  if(tarball){try{fs.unlinkSync(path.join(root,tarball));}catch(_){}}
  fs.rmSync(temp,{recursive:true,force:true});
}

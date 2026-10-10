'use strict';

// Real-process acceptance tests: invoke the published Shell entry point against
// actual native SQLite, not a fake SQL client.

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const executable = path.resolve(__dirname, '../apps/shell/bin/nublox.js');

function launch(args, options = {}) {
  const result = cp.spawnSync(process.execPath, [executable, ...args], {
    encoding:'utf8',
    timeout:20000,
    input:options.input,
    env: { ...process.env, ...options.env },
    maxBuffer:1024*1024
  });
  if(result.error)throw result.error;
  return result;
}

function expectSuccess(result, label) {
  assert.equal(result.status,0,label+'\nstdout:\n'+result.stdout+'\nstderr:\n'+result.stderr);
  assert.equal(result.signal,null,label+' terminated by signal');
}

function demoNoConfiguration() {
  const res=launch(['--demo','--format','json'],{
    env:{
      // An accidental production DATABASE_URL must never override the isolated demo.
      NUBLOX_DATABASE_URL:'postgresql://unused:do-not-connect@127.0.0.1:1/secret',
      DATABASE_URL:'postgresql://unused:do-not-connect@127.0.0.1:1/secret'
    }
  });
  expectSuccess(res,'demo should use real in-memory SQLite');
  const demo=JSON.parse(res.stdout);
  assert.equal(demo.status,'ok');
  assert.equal(demo.mode,'demo');
  assert.equal(demo.dialect,'sqlite');
  assert.equal(demo.database,':memory:');
  assert.ok(/^\d+\.\d+\.\d+/.test(demo.serverVersion));
  assert.ok(demo.tables.includes('nublox_demo'));
  assert.deepEqual(demo.rows,[
    {id:1,name:'NuBloxSQL'},
    {id:2,name:'SQLite'}
  ]);
  assert.ok(!res.stdout.includes('do-not-connect'),'credentials must not appear in demo output');

  const defaultMode=launch(['--demo'],{
    env:{NUBLOX_DATABASE_URL:''}
  });
  expectSuccess(defaultMode,'default table demo');
  assert.match(defaultMode.stdout,/NuBloxSQL/);

  const incompatible=launch(['--demo','--execute','SELECT 1']);
  assert.equal(incompatible.status,2);
  assert.match(incompatible.stderr,/only one of/);
}

function doctorSelfTest() {
  const result=launch(['--doctor','--format','json'],{
    env:{NUBLOX_DATABASE_URL:'',DATABASE_URL:'',NUBLOX_DIALECT:''}
  });
  expectSuccess(result,'doctor self-test');
  const body=JSON.parse(result.stdout);
  assert.deepEqual({
    status:body.status,mode:body.mode,dialect:body.dialect,
    databasesVisible:body.databasesVisible,check:body.check
  },{status:'ok',mode:'self-test',dialect:'sqlite',databasesVisible:1,check:1});
  assert.ok(body.serverVersion);
}

function liveFileAcceptance() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nublox-working-tonight-'));
  const filename=path.join(directory,'acceptance.sqlite');
  try {
    const sqlite=new DatabaseSync(filename);
    try {
      sqlite.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
      sqlite.prepare('INSERT INTO products (id, title) VALUES (?, ?)').run(1,'Operational test');
    } finally {sqlite.close();}

    const args=['--dialect','sqlite','--filename',filename];
    let result=launch([...args,'--doctor','--format','json']);
    expectSuccess(result,'doctor on actual persisted SQLite file');
    const doctor=JSON.parse(result.stdout);
    assert.equal(doctor.status,'ok');
    assert.equal(doctor.mode,'connection');
    assert.equal(doctor.dialect,'sqlite');
    assert.equal(doctor.check,1);

    result=launch([...args,'--execute','SELECT id, title FROM products','--format','json']);
    expectSuccess(result,'real persistent SELECT');
    assert.deepEqual(JSON.parse(result.stdout),[{id:1,title:'Operational test'}]);

    result=launch([...args,'--command','\\tables','--format','json']);
    expectSuccess(result,'metadata introspection');
    const tables=JSON.parse(result.stdout);
    assert.ok(tables.some(item=>item.name==='products'));

    result=launch([...args,'--command','\\describe products','--format','json']);
    expectSuccess(result,'table description');
    const description=JSON.parse(result.stdout);
    assert.equal(description.table.name,'products');
    assert.ok(description.columns.some(item=>item.name==='title'));

    result=launch([...args,'--format','table'],{
      input:'\\tables\nSELECT id, title FROM products;\n\\quit\n'
    });
    expectSuccess(result,'non-interactive stdin REPL');
    assert.match(result.stdout,/Operational test/);
    assert.match(result.stdout,/products/);

    // Real non-interactive session: query, in-memory history, disconnect,
    // reconnect and read metadata without restarting the process.
    result=launch([...args,'--format','table'],{
      input:'\\status\n\\history\n\\history on\nSELECT id, title FROM products;\n\\history\n\\disconnect\n\\status\n\\reconnect\n\\tables\n\\history off\n\\quit\n'
    });
    expectSuccess(result,'full REPL reconnect/history workflow');
    assert.match(result.stdout,/Disconnected/);
    assert.match(result.stdout,/Connected to sqlite/);
    assert.match(result.stdout,/History is disabled/);
    assert.match(result.stdout,/Operational test/);
    assert.match(result.stdout,/products/);
    // node:sqlite is experimental on Node.js 22; accept only its known runtime notice.
    var warnings=result.stderr.split('\n').filter(Boolean);
    assert.ok(warnings.every(function(line){
      return /ExperimentalWarning: SQLite is an experimental feature|Use `node --trace-warnings/.test(line);
    }), 'unexpected stderr in full REPL workflow: '+result.stderr);

    result=launch([...args,'--format','table'],{
      input:'SELECT missing_column FROM products;\nSELECT id, title FROM products;\n'
    });
    assert.equal(result.status,1,'piped REPL must return failure if any SQL statement fails');
    assert.match(result.stderr,/missing_column|column/i);
    assert.match(result.stdout,/Operational test/,'subsequent statements still run');

    result=launch([...args],{input:'SELECT id FROM products\n'});
    assert.equal(result.status,1,'incomplete SQL at EOF must fail');
    assert.match(result.stderr,/unfinished SQL statement/);

    result=launch([...args],{input:'SELECT id FROM\n\\reset\nSELECT title FROM products;\n'});
    expectSuccess(result,'unfinished SQL reset');
    assert.match(result.stdout,/SQL statement buffer is empty/);
    assert.match(result.stdout,/Operational test/);

    result=launch([...args],{input:'x'.repeat(1024*1024+1)+'\n'});
    assert.equal(result.status,1,'piped REPL must reject oversized SQL');
    assert.match(result.stderr,/1 MiB interactive limit/);

    const sqlFile=path.join(directory,'query.sql');
    fs.writeFileSync(sqlFile,'SELECT id, title FROM products ORDER BY id;\n');
    result=launch([...args,'--stdin','--format','csv'],{input:fs.readFileSync(sqlFile,'utf8')});
    expectSuccess(result,'SQL file piped through stdin to CSV on stdout');
    assert.equal(result.stdout,'id,title\n1,Operational test\n');
    const exportFile=path.join(directory,'export.csv');
    fs.writeFileSync(exportFile,result.stdout,{flag:'wx',mode:0o600});
    assert.equal(fs.readFileSync(exportFile,'utf8'),'id,title\n1,Operational test\n');

    result=launch([...args,'--stdin'],{input:''});
    assert.equal(result.status,1,'empty statement is rejected');

    result=launch([...args,'--stdin'],{input:' '.repeat(1024*1024+1)});
    assert.equal(result.status,1,'oversized statement is rejected');

    result=launch([...args,'--stdin','--execute','SELECT 1'],{input:'SELECT 1'});
    assert.equal(result.status,2,'stdin and inline SQL are mutually exclusive');

    const missing=launch(['--dialect','sqlite','--filename',path.join(directory,'missing.sqlite'),'--option','mode=readonly','--doctor']);
    assert.equal(missing.status,1,'read-only check of missing database must fail');
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

function invalidUsage() {
  let res=launch([]);
  assert.equal(res.status,2);
  assert.match(res.stderr,/Try --demo or --doctor/);

  res=launch(['--help']);
  expectSuccess(res,'Shell help');
  assert.match(res.stdout,/--demo/);
  assert.match(res.stdout,/--doctor/);
  assert.match(res.stdout,/--stdin/);
}

demoNoConfiguration();
doctorSelfTest();
liveFileAcceptance();
invalidUsage();
console.log('NuBloxSQL real-process runnable Shell acceptance: PASS');

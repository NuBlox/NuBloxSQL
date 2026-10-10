'use strict';

// Real NuBloxSQL client + HTTP + browser resources; no mocked DB driver.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const sqlApi=require('../index');
const {createWorkbench,quote}=require('../apps/workbench/lib/Server');
const {buildBrowsePlan}=require('../apps/workbench/lib/Browse');
const {compile}=require('../lib/client/Sql');
const launcher=require('../apps/workbench/bin/nublox-workbench');

function statusUrl(base,route){return base+route.replace(/^\//,'');}
async function request(base,token,route,body,more={}){
  const headers={'x-nublox-session':token};
  if(body!==undefined)headers['Content-Type']='application/json';
  Object.assign(headers,more);
  return fetch(statusUrl(base,route),{
    method:body===undefined?'GET':'POST',
    headers,
    body:body===undefined?undefined:JSON.stringify(body)
  });
}
async function expectJson(response,code){
  assert.equal(response.status,code);
  return response.json();
}
async function demoAcceptance(){
  const app=createWorkbench({sqlApi,demo:true});
  const base=await app.listen(0);
  try {
    assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const htmlResponse=await fetch(base);
    assert.equal(htmlResponse.status,200);
    assert.match(htmlResponse.headers.get('content-security-policy'),/default-src 'none'/);
    assert.equal(htmlResponse.headers.get('x-frame-options'),'DENY');
    const html=await htmlResponse.text();
    const matched=html.match(/name="nublox-session" content="([0-9a-f]{64})"/);
    assert.ok(matched,'browser receives ephemeral bearer token');
    const token=matched[1];
    assert.ok(!html.includes('WORKBENCH_SESSION_TOKEN'));
    assert.match(html,/id="browse-controls"/);
    assert.match(html,/id="browse-next"/);
    assert.match(html,/id="sort-column"/);
    assert.match(html,/id="filter-column"/);

    const js=await fetch(statusUrl(base,'/assets/app.js'));
    assert.equal(js.status,200);
    const javascript=await js.text();
    assert.match(javascript,/createObjectURL/,'CSV export is implemented in browser');
    assert.ok(!javascript.includes('innerHTML'),'DB data is never put into HTML');
    assert.match(javascript,/browsePage/);
    const css=await fetch(statusUrl(base,'/assets/styles.css'));
    assert.equal(css.status,200);
    assert.match(await css.text(),/data-grid/);

    await expectJson(await fetch(statusUrl(base,'/api/status')),403);
    await expectJson(await request(base,'wrong','/api/status'),403);
    await expectJson(await request(base,token,'/api/status',undefined,{Origin:'https://untrusted.example'}),403);
    const status=await expectJson(await request(base,token,'/api/status'),200);
    assert.equal(status.status,'connected');
    assert.equal(status.dialect,'sqlite');
    assert.equal(status.demo,true);
    assert.equal(status.maxRows,200);
    assert.ok(!JSON.stringify(status).includes('password'));

    const tables=await expectJson(await request(base,token,'/api/tables'),200);
    assert.ok(tables.tables.some(t=>t.name==='nublox_demo'));
    const meta=await expectJson(await request(base,token,'/api/columns',{name:'nublox_demo',schema:'main'}),200);
    assert.ok(meta.columns.some(c=>c.name==='name'));
    const preview=await expectJson(await request(base,token,'/api/preview',{name:'nublox_demo',schema:'main'}),200);
    assert.deepEqual(preview.rows,[{id:1,name:'NuBloxSQL'},{id:2,name:'Workbench'}]);
    assert.equal(preview.shown,2);
    assert.equal(preview.hasMore,false);
    assert.equal(preview.offset,0);
    assert.equal(preview.pageSize,50);
    assert.equal(preview.sort,'id');
    assert.equal(preview.direction,'asc');

    // Populate enough rows to demand *actual* database-side pagination.
    const bulk=Array.from({length:124},(_,i)=>"("+(i+3)+",'Row "+(i+3)+"')").join(',');
    await expectJson(await request(base,token,'/api/query',{
      sql:'INSERT INTO nublox_demo (id,name) VALUES '+bulk
    }),200);

    const pageOne=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:0,pageSize:40,sort:'id',direction:'asc'
    }),200);
    assert.equal(pageOne.rows.length,40);
    assert.equal(pageOne.rows[0].id,1);
    assert.equal(pageOne.rows[39].id,40);
    assert.equal(pageOne.hasMore,true);

    const pageTwo=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:40,pageSize:40,sort:'id',direction:'asc'
    }),200);
    assert.equal(pageTwo.rows.length,40);
    assert.equal(pageTwo.rows[0].id,41);
    assert.equal(pageTwo.rows[39].id,80);
    assert.equal(pageTwo.hasMore,true);

    const pageLast=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:120,pageSize:40,sort:'id',direction:'asc'
    }),200);
    assert.equal(pageLast.rows.length,6);
    assert.equal(pageLast.rows[0].id,121);
    assert.equal(pageLast.hasMore,false);

    const descending=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:0,pageSize:3,sort:'id',direction:'desc'
    }),200);
    assert.deepEqual(descending.rows.map(row=>row.id),[126,125,124]);
    assert.equal(descending.hasMore,true);
    const filtered=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:0,pageSize:10,
      sort:'id',filter:{column:'name',value:'Row 73'}
    }),200);
    assert.deepEqual(filtered.rows,[{id:73,name:'Row 73'}]);
    assert.equal(filtered.filtered,true);
    assert.equal(filtered.hasMore,false);

    const probe=await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',filter:{column:'name',value:"' OR 1=1 --"}
    }),200);
    assert.equal(probe.rows.length,0,'filter must be parameterized, never concatenated');
    await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',sort:'id;DROP TABLE nublox_demo'
    }),400);
    await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',filter:{column:'name) OR 1=1 --',value:'x'}
    }),400);
    await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',pageSize:201
    }),400);
    await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',offset:-1
    }),400);
    await expectJson(await request(base,token,'/api/preview',{
      name:'nublox_demo',direction:'ASC; DROP TABLE nublox_demo;'
    }),400);

    const result=await expectJson(await request(base,token,'/api/query',{sql:'SELECT id,name FROM nublox_demo ORDER BY id'}),200);
    assert.equal(result.rows[0].name,'NuBloxSQL');
    assert.deepEqual(result.columns,['id','name']);
    assert.equal(result.shown,126);
    const injected=await expectJson(await request(base,token,'/api/preview',{name:'nublox_demo; DROP TABLE nublox_demo'}),404);
    assert.match(injected.error,/not present/);
    await expectJson(await request(base,token,'/api/query',{sql:'  '}),400);
    await expectJson(await request(base,token,'/api/query',{sql:'x'.repeat(17000)}),413);
    await expectJson(await request(base,token,'/api/query',{sql:'SELECT nonexistent FROM nublox_demo'}),500);
    const goodAgain=await expectJson(await request(base,token,'/api/query',{sql:'SELECT count(*) AS total FROM nublox_demo'}),200);
    assert.equal(goodAgain.rows[0].total,126);
  } finally {await app.close();}
}
async function existingFileAcceptance(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nublox-workbench-'));
  const filename=path.join(dir,'database.sqlite');
  const sqlite=new DatabaseSync(filename);
  try{
    sqlite.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    sqlite.prepare('INSERT INTO products (id,name) VALUES (?,?)').run(7,'Real file');
  }finally{sqlite.close();}
  const app=createWorkbench({sqlApi,connection:{dialect:'sqlite',filename,mode:'readonly',pool:false},maxRows:1});
  try {
    const base=await app.listen(0);
    const html=await (await fetch(base)).text();
    const token=html.match(/name="nublox-session" content="([0-9a-f]{64})"/)[1];
    const status=await expectJson(await request(base,token,'/api/status'),200);
    assert.equal(status.demo,false);
    const result=await expectJson(await request(base,token,'/api/query',{sql:'SELECT * FROM products'}),200);
    assert.deepEqual(result.rows,[{id:7,name:'Real file'}]);
    assert.equal(result.shown,1);
    assert.equal(result.truncated,false);
    const first=await expectJson(await request(base,token,'/api/preview',{name:'products',pageSize:1}),200);
    assert.deepEqual(first.rows,[{id:7,name:'Real file'}]);
    assert.equal(first.hasMore,false);
    await expectJson(await request(base,token,'/api/preview',{name:'products',pageSize:2}),400);
    const tables=await expectJson(await request(base,token,'/api/tables'),200);
    assert.ok(tables.tables.some(t=>t.name==='products'));
    await expectJson(await request(base,token,'/api/query',{sql:"INSERT INTO products VALUES (8,'unwanted')"}),500);
    const check=new DatabaseSync(filename);
    try{assert.equal(check.prepare('SELECT count(*) AS total FROM products').get().total,1);}
    finally{check.close();}
  } finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
}

function dialectBrowseContracts(){
  const columns=[{name:'id',primaryKey:true},{name:'display name',primaryKey:false}];
  for(const dialect of ['mysql','postgresql','sqlite','sqlserver']){
    const plan=buildBrowsePlan({sqlApi,dialect,maxRows:100,
      table:{name:'data sheet',schema:'schema name'},columns,
      options:{offset:25,pageSize:10,sort:'display name',direction:'desc',
        filter:{column:'display name',value:"O'Neil OR 1=1 --"}}});
    const dialectService=sqlApi.descriptor(dialect).services;
    const compiled=compile(plan.statement,dialectService);
    assert.ok(compiled.text.includes('ORDER BY'));
    assert.ok(compiled.text.includes('DESC'));
    assert.equal(compiled.parameters.length,3);
    assert.deepEqual(compiled.parameters[0],"O'Neil OR 1=1 --");
    assert.deepEqual(compiled.parameters.slice(1),dialect==='sqlserver'?[25,11]:[11,25]);
    assert.ok(!compiled.text.includes("O'Neil"),'filter values remain parameters');
    if(dialect==='sqlserver')assert.match(compiled.text,/OFFSET.*ROWS FETCH NEXT.*ROWS ONLY/);
    else assert.match(compiled.text,/LIMIT.*OFFSET/);
    assert.equal(plan.pageSize,10);
    assert.equal(plan.offset,25);
  }
}

async function launcherAcceptance(){
  const output=[];
  const streams={stdout:{write(text){output.push(text);}}};
  assert.equal(await launcher.run(['--help'],{},streams),null);
  assert.match(output.join(''),/127\.0\.0\.1/);
  await assert.rejects(launcher.run(['--port','65536','--demo'],{},streams),/port/);
  const app=await launcher.run(['--demo','--port','0'],{
    NUBLOX_DATABASE_URL:'postgresql://should-not-connect:secret@127.0.0.1:1/not-used'
  },streams);
  try{
    assert.ok(app.port>0);
    assert.ok(output.some(x=>x.includes('Workbench ready:')));
    const base='http://127.0.0.1:'+app.port+'/';
    assert.equal((await fetch(base)).status,200);
  }finally{await app.close();}
}
(async()=>{
  assert.equal(quote('mysql','danger\x60table'),'\x60danger\x60\x60table\x60');
  assert.equal(quote('sqlserver','danger]table'),'[danger]]table]');
  assert.equal(quote('sqlite','danger"table'),'"danger""table"');
  dialectBrowseContracts();
  await demoAcceptance();
  await existingFileAcceptance();
  await launcherAcceptance();
  console.log('NuBloxSQL Workbench live HTTP + native SQLite acceptance: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

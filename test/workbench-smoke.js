'use strict';

// Real NuBloxSQL client + HTTP + browser resources; no mocked DB driver.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const sqlApi=require('../index');
const {createWorkbench,quote}=require('../apps/workbench/lib/Server');
const {buildBrowsePlan}=require('../apps/workbench/lib/Browse');
const {compile}=require('../lib/client/Sql');
const launcher=require('../apps/workbench/bin/nublox-workbench');
const {normalizePlan}=require('../apps/workbench/lib/Plan');

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
    assert.match(html,/id="cancel-query"/);
    assert.match(html,/id="explain-query"/);
    assert.match(html,/id="completion-panel"/);
    assert.match(html,/id="sql-highlight"/);
    assert.match(html,/id="format-query"/);
    assert.match(html,/class="editor-input-layer"/);
    assert.match(html,/assets\/editor-tools.js/);
    assert.match(html,/id="sort-column"/);
    assert.match(html,/id="filter-column"/);

    const js=await fetch(statusUrl(base,'/assets/app.js'));
    assert.equal(js.status,200);
    const javascript=await js.text();
    assert.match(javascript,/createObjectURL/,'CSV export is implemented in browser');
    assert.ok(!javascript.includes('innerHTML'),'DB data is never put into HTML');
    assert.match(javascript,/browsePage/);
    assert.match(javascript,/explainSQL/);
    assert.match(javascript,/showCompletion/);
    assert.match(javascript,/renderHighlight/);
    assert.match(javascript,/formatCurrentSQL/);
    assert.match(javascript,/syncEditorScroll/);
    assert.match(javascript,/columnCache/);
    const editorSource=await (await fetch(statusUrl(base,'/assets/editor-tools.js'))).text();
    const sandbox={window:{}};
    vm.runInNewContext(editorSource,sandbox,{timeout:1000});
    const tools=sandbox.window.NuBloxEditorTools;
    assert.ok(tools&&typeof tools.suggestions==='function');
    const statement='SELECT * FROM nub';
    const completion=tools.suggestions(statement,statement.length,{
      dialect:'sqlite',tables:[{name:'nublox_demo',schema:'main',type:'table'}]
    });
    const tableCompletion=completion.find(item=>item.label==='nublox_demo');
    assert.ok(tableCompletion,'catalogue table is suggested');
    assert.equal(tableCompletion.insert,'"main"."nublox_demo"');
    assert.equal(tableCompletion.from,14);
    assert.equal(tableCompletion.to,17);
    const columnSuggestions=tools.suggestions('SELECT na',9,{
      dialect:'sqlite',columns:[{name:'name'}]
    });
    assert.ok(columnSuggestions.some(item=>item.kind==='column'&&item.insert==='"name"'));
    assert.equal(tools.identifier('order]items','sqlserver'),'[order]]items]');
    assert.equal(tools.identifier('order'+String.fromCharCode(96)+'items','mysql'),
      String.fromCharCode(96)+'order'+String.fromCharCode(96)+String.fromCharCode(96)+'items'+String.fromCharCode(96));
    assert.equal(tools.suggestions("SELECT 'nub",11,{manual:true,dialect:'sqlite'}).length,0);
    assert.equal(tools.suggestions('SELECT -- nub',13,{manual:true,dialect:'sqlite'}).length,0);
    assert.equal(tools.suggestions('SELECT /* nub',13,{manual:true,dialect:'sqlite'}).length,0);
    assert.ok(tools.suggestions('SELECT nu',9,{manual:false,dialect:'sqlite',
      tables:[{name:'nublox_demo'}]}).some(item=>item.label==='nublox_demo'));

    // The mirror lexer must preserve every byte of native SQL, including
    // literals/comments and dialect-specific quoted identifiers.
    const highlightCases=[
      ['sqlite',"SELECT id, 'it''s <unsafe>' FROM \"order items\" -- note\\nWHERE id = 42"],
      ['mysql', 'select `odd`, 23.5 from `sales` # hash comment\\nwhere x=1'],
      ['postgresql', "SELECT $"+"$a 'quote' -- still literal$"+"$, $tag$something$tag$"],
      ['sqlserver','SELECT [right]]name] FROM [order]; /* testing */'],
      ['sqlite','SELECT * FROM t /* unterminated comment']
    ];
    for(const [dialect,raw] of highlightCases){
      const source=raw;
      const parts=tools.highlight(source,dialect);
      assert.equal(parts.map(p=>p.text).join(''),source,'lossless SQL highlighting '+dialect);
      assert.ok(parts.every(p=>typeof p.text==='string'&&typeof p.kind==='string'));
    }
    const coloured=tools.highlight("SELECT 'danger <b>x</b>' AS label -- comment", 'sqlite');
    assert.ok(coloured.some(p=>p.kind==='keyword'&&p.text==='SELECT'));
    assert.ok(coloured.some(p=>p.kind==='string'&&p.text.includes('<b>')));
    assert.ok(coloured.some(p=>p.kind==='comment'));
    const joined='SELECT o.to FROM customers c JOIN orders o ON o.customer_id = c.id';
    const orderMetadata=[
      {name:'customers',schema:'main',type:'table'},
      {name:'orders',schema:'main',type:'table'}
    ];
    const aliasCursor=joined.indexOf('o.to')+4;
    const resolved=tools.resolveColumnContext(joined,aliasCursor,{
      dialect:'sqlite',tables:orderMetadata
    });
    assert.equal(resolved.name,'orders');
    const aliasCompletions=tools.suggestions(joined,aliasCursor,{
      dialect:'sqlite',tables:orderMetadata,columns:[{name:'total'},{name:'customer_id'}]
    });
    assert.ok(aliasCompletions.some(c=>c.kind==='column'&&c.label==='total'&&c.insert==='"total"'));
    assert.ok(!aliasCompletions.some(c=>c.kind==='keyword'));
    const aliasDot='SELECT o. FROM customers c JOIN orders o';
    const dot=tools.suggestions(aliasDot,aliasDot.indexOf('o.')+2,{
      dialect:'sqlite',tables:orderMetadata,columns:[{name:'total'}]
    });
    assert.ok(dot.some(c=>c.label==='total'),'column suggestions appear after alias dot');
    assert.equal(tools.resolveColumnContext('SELECT x.to FROM absent x',11,{
      dialect:'sqlite',tables:orderMetadata
    }),null,'do not infer columns for unknown database objects');
    assert.equal(tools.resolveColumnContext("SELECT 'o.to' FROM orders o",11,{
      dialect:'sqlite',tables:orderMetadata
    }),null,'do not complete inside strings');
    assert.equal(tools.resolveColumnContext('SELECT o.to; SELECT 1 FROM orders o',11,{
      dialect:'sqlite',tables:orderMetadata
    }),null,'do not steal alias from next statement');

    const sources=[
      ['SELECT c.id FROM customers c WHERE EXISTS (SELECT o.to FROM orders o)', 'o.to','orders'],
      ['SELECT c.id FROM customers c WHERE EXISTS (SELECT c.na FROM orders o)', 'c.na','customers']
    ];
    for(const [text,needle,expected] of sources){
      const position=text.indexOf(needle)+needle.length;
      const target=tools.resolveColumnContext(text,position,{
        dialect:'sqlite',tables:orderMetadata
      });
      assert.equal(target.name,expected,'nearest SQL scope must win');
    }
    const declared='WITH recent(order_id, amount) AS (SELECT id,total FROM orders) SELECT r.am FROM recent r';
    const alias=tools.resolveColumnContext(declared,declared.indexOf('r.am')+4,{
      dialect:'sqlite',tables:orderMetadata
    });
    assert.equal(alias.virtual,true,'CTE becomes an in-memory completion source');
    assert.deepEqual(Array.from(alias.virtualColumns,c=>c.name),['order_id','amount']);
    const cteSuggestions=tools.suggestions(declared,declared.indexOf('r.am')+4,{
      dialect:'sqlite',tables:orderMetadata,columns:[]
    });
    assert.ok(cteSuggestions.some(s=>s.label==='amount'&&s.insert==='"amount"'));
    const inferred='WITH recent AS (SELECT id,total AS amount FROM orders) SELECT r.am FROM recent r';
    const inferredCols=tools.resolveColumnContext(inferred,inferred.indexOf('r.am')+4,{
      dialect:'sqlite',tables:orderMetadata
    });
    assert.deepEqual(Array.from(inferredCols.virtualColumns,c=>c.name),['id','amount']);
    const malformed='SELECT o.to; SELECT * FROM orders o';
    assert.equal(tools.resolveColumnContext(malformed,malformed.indexOf('o.to')+4,{
      dialect:'sqlite',tables:orderMetadata
    }),null);
    const original="SELECT id, name FROM nublox_demo WHERE name = 'NuBloxSQL' ORDER BY id";
    const formatted=tools.formatSQL(original,'sqlite');
    assert.match(formatted,/\nFROM /);
    assert.match(formatted,/\nWHERE /);
    assert.match(formatted,/\nORDER BY /);
    assert.equal(tools.formatSQL(formatted,'sqlite'),formatted,'formatter is idempotent');
    assert.throws(()=>tools.formatSQL("SELECT 1; DELETE FROM demo",'sqlite'),/one SQL statement/);
    assert.throws(()=>tools.formatSQL('SELECT x -- comment\nFROM data','sqlite'),/comments/);
    assert.throws(()=>tools.formatSQL("SELECT 'unterminated",'sqlite'),/Unclosed/);
    const literal="SELECT $a FROM x$ AS value FROM sample WHERE x = 'hello'";
    const pgFormatted=tools.formatSQL(literal,'postgresql');
    assert.ok(pgFormatted.includes('$a FROM x$'),'dollar string is unchanged');

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
    assert.equal(status.queryControl.nativeRowByteBudget,true);
    assert.equal(status.queryControl.cancelSupported,false);
    assert.equal(status.queryControl.timeoutMs,null);
    assert.equal(status.queryControl.maxResultBytes,1048576);
    assert.equal(status.editorFeatures.completion,true);
    assert.equal(status.editorFeatures.formatting,true);
    assert.equal(status.editorFeatures.planSupported,true);
    await expectJson(await request(base,'wrong','/api/diagnose',{sql:'SELECT 1'}),403);
    await expectJson(await request(base,token,'/api/diagnose',{sql:'SELECT 1'},
      {Origin:'https://untrusted.example'}),403);
    await expectJson(await request(base,token,'/api/diagnose',{sql:'  '}),400);
    await expectJson(await request(base,token,'/api/diagnose',{sql:'x'.repeat(17000)}),413);
    const plan=await expectJson(await request(base,token,'/api/diagnose',{
      sql:'SELECT id,name FROM nublox_demo WHERE name = \'NuBloxSQL\''
    }),200);
    assert.equal(plan.mode,'plan');
    assert.equal(plan.statementExecuted,false);
    assert.ok(plan.summary.nodeCount>=1);
    assert.ok(plan.nodes.length>=1);
    assert.equal(typeof plan.nodes[0].detail,'string');
    assert.ok(!JSON.stringify(plan).includes('SELECT id,name FROM nublox_demo'),
      'SQL text must not be echoed into optimizer report');
    const beforePlanMutation=await expectJson(await request(base,token,'/api/query',{
      sql:'SELECT count(*) AS total FROM nublox_demo'
    }),200);
    await expectJson(await request(base,token,'/api/diagnose',{
      sql:'DELETE FROM nublox_demo WHERE id = 1'
    }),200);
    const afterPlanMutation=await expectJson(await request(base,token,'/api/query',{
      sql:'SELECT count(*) AS total FROM nublox_demo'
    }),200);
    assert.equal(afterPlanMutation.rows[0].total,beforePlanMutation.rows[0].total,
      'EXPLAIN must not execute even a mutating SQL statement');
    await expectJson(await request(base,token,'/api/cancel',{}),501);
    assert.ok(!JSON.stringify(status).includes('password'));

    const tables=await expectJson(await request(base,token,'/api/tables'),200);
    assert.ok(tables.tables.some(t=>t.name==='nublox_demo'));
    const meta=await expectJson(await request(base,token,'/api/columns',{name:'nublox_demo',schema:'main'}),200);
    assert.ok(meta.columns.some(c=>c.name==='name'));
    const preview=await expectJson(await request(base,token,'/api/preview',{name:'nublox_demo',schema:'main'}),200);
    assert.deepEqual(preview.rows,[{id:1,name:'NuBloxSQL'},{id:2,name:'Workbench'}]);
    const originalRows=await expectJson(await request(base,token,'/api/query',{sql:original}),200);
    const formattedRows=await expectJson(await request(base,token,'/api/query',{sql:formatted}),200);
    assert.deepEqual(formattedRows.rows,originalRows.rows,'formatting must preserve SQL query results');
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
    const rowsResponse=await request(base,token,'/api/query',{
      sql:'SELECT a.id AS a, b.id AS b FROM nublox_demo a CROSS JOIN nublox_demo b'
    });
    assert.equal(rowsResponse.status,413,await rowsResponse.clone().text());
    const rowsOverBudget=await rowsResponse.json();
    assert.match(rowsOverBudget.error,/budget/);
    const bytesResponse=await request(base,token,'/api/query',{
      sql:'SELECT hex(zeroblob(150000)) AS big_data'
    });
    assert.equal(bytesResponse.status,413,await bytesResponse.clone().text());
    const bytesOverBudget=await bytesResponse.json();
    assert.match(bytesOverBudget.error,/budget/);
    const readyAgain=await expectJson(await request(base,token,'/api/query',{
      sql:'SELECT 1 AS ok'
    }),200);
    assert.equal(readyAgain.rows[0].ok,1);
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
    assert.equal(status.editorFeatures.planSupported,true);
    const readOnlyPlan=await expectJson(await request(base,token,'/api/diagnose',{
      sql:'SELECT id,name FROM products'
    }),200);
    assert.equal(readOnlyPlan.statementExecuted,false);
    assert.ok(readOnlyPlan.nodes.length>=1);
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

async function cancellationContractAcceptance(){
  let startQuery;
  const started=new Promise(resolve=>{startQuery=resolve;});
  let seenOptions;
  const fakeClient={
    dialect:'postgresql',
    metadata:{tables:async()=>[],columns:async()=>[]},
    one:async()=>({nublox_check:1}),
    diagnose:async function(_statement,options){
      seenOptions=options;
      return {analyzed:false,statementExecuted:false,summary:{estimatedRows:5},native:{root:{'Node Type':'Seq Scan','Relation Name':'tasks','Plan Rows':5}}};
    },
    query:async function(statement,options){
      seenOptions=options;startQuery();
      return new Promise(function(_resolve,reject){
        options.signal.addEventListener('abort',function(){
          reject(options.signal.reason||new Error('Query cancelled'));
        },{once:true});
      });
    },
    close:async()=>{}
  };
  const app=createWorkbench({sqlApi:{createClient:()=>fakeClient},connection:{dialect:'postgresql'}});
  const base=await app.listen(0);
  try{
    const page=await (await fetch(base)).text();
    const token=page.match(/name="nublox-session" content="([0-9a-f]{64})"/)[1];
    const status=await expectJson(await request(base,token,'/api/status'),200);
    assert.equal(status.queryControl.cancelSupported,true);
    assert.equal(status.queryControl.timeoutMs,15000);
    assert.equal(status.queryControl.nativeRowByteBudget,false);
    assert.equal(status.editorFeatures.planSupported,true);
    const report=await expectJson(await request(base,token,'/api/diagnose',{sql:'SELECT 1'}),200);
    assert.equal(report.mode,'plan');
    assert.equal(report.dialect,'postgresql');
    assert.equal(report.statementExecuted,false);
    assert.equal(report.nodes[0].kind,'Seq Scan');
    assert.equal(seenOptions.analyze,false);
    assert.equal(seenOptions.timeout,15000);
    assert.ok(seenOptions.signal instanceof AbortSignal);
    await expectJson(await request(base,token,'/api/cancel',{}),409);
    const pending=request(base,token,'/api/query',{sql:'SELECT pg_sleep(30)'});
    await started;
    assert.equal(seenOptions.timeout,15000);
    assert.ok(seenOptions.signal instanceof AbortSignal);
    await expectJson(await request(base,token,'/api/query',{sql:'SELECT 2'}),409);
    const result=await expectJson(await request(base,token,'/api/cancel',{}),202);
    assert.equal(result.status,'cancellation-requested');
    const cancelled=await expectJson(await pending,500);
    assert.match(cancelled.error,/cancelled/);
    await expectJson(await request(base,token,'/api/cancel',{}),409);
  }finally{await app.close();}
}


async function multiDialectPlanContracts(){
  const postgres=normalizePlan('postgresql',{
    analyzed:false,statementExecuted:false,
    summary:{estimatedRows:10,estimatedCost:2.5},
    native:{root:{'Node Type':'Hash Join',Plans:[
      {'Node Type':'Seq Scan','Relation Name':'customers'},
      {'Node Type':'Index Scan','Relation Name':'orders','Index Name':'idx_orders_id'}
    ]}}
  },3);
  assert.equal(postgres.nodes.length,3);
  assert.equal(postgres.nodes[1].kind,'Seq Scan');
  assert.equal(postgres.summary.usesIndex,true);
  assert.equal(postgres.summary.hasFullScan,true);
  const mysql=normalizePlan('mysql',{
    analyzed:false,statementExecuted:false,
    native:{root:{query_block:{table:{table_name:'orders',access_type:'ALL'}}}},
    summary:{estimatedRows:12}
  },4);
  assert.equal(mysql.nodes.length,1);
  assert.equal(mysql.nodes[0].table,'orders');
  assert.equal(mysql.summary.hasFullScan,true);
  assert.throws(()=>normalizePlan('mysql',{analyzed:true,statementExecuted:true,native:{root:{}}},1),
    /executed/,'analyze:true can execute DML and must never be displayed as safe plan');
  assert.throws(()=>normalizePlan('sqlserver',{statementExecuted:false},1),/no Workbench plan/);
  for(const dialect of ['mysql','postgresql']){
    let called;
    const client={dialect,metadata:{tables:async()=>[],columns:async()=>[]},
      one:async()=>({ok:1}),query:async()=>({rows:[]}),close:async()=>{},
      diagnose:async(sql,opts)=>{
        called={sql,opts};
        return dialect==='mysql'?
          {analyzed:false,statementExecuted:false,native:{root:{operation:'Table scan',table_name:'t',access_type:'ALL'}},summary:{}}:
          {analyzed:false,statementExecuted:false,native:{root:{'Node Type':'Seq Scan','Relation Name':'t'}},summary:{}};
      }};
    const app=createWorkbench({sqlApi:{createClient:()=>client},connection:{dialect}});
    const base=await app.listen(0);
    try{
      const html=await (await fetch(base)).text();
      const token=html.match(/name="nublox-session" content="([0-9a-f]{64})"/)[1];
      const status=await expectJson(await request(base,token,'/api/status'),200);
      assert.equal(status.editorFeatures.planSupported,true);
      await expectJson(await request(base,'wrong','/api/diagnose',{sql:'SELECT 1'}),403);
      const report=await expectJson(await request(base,token,'/api/diagnose',{sql:'DELETE FROM t'}),200);
      assert.equal(report.statementExecuted,false);
      assert.equal(report.dialect,dialect);
      assert.ok(report.nodes.length>0);
      assert.equal(called.sql,'DELETE FROM t');
      assert.equal(called.opts.analyze,false);
      assert.equal(called.opts.timeout,15000);
      assert.ok(called.opts.signal instanceof AbortSignal);
    }finally{await app.close();}
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
  await cancellationContractAcceptance();
  await multiDialectPlanContracts();
  await launcherAcceptance();
  console.log('NuBloxSQL Workbench live HTTP + native SQLite acceptance: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});

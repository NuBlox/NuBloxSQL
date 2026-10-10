'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

// Local-only, single-session application built on the public NuBloxSQL API.
const HTML=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const SCRIPT=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const STYLE=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
const MAX_REQUEST=32768;
function serialize(value) {
  return JSON.stringify(value,function(_key,item){
    if(typeof item==='bigint')return item.toString();
    if(item instanceof Date)return item.toISOString();
    return item;
  });
}
function quote(dialect,name){
  if(dialect==='mysql')return '\x60'+name.split('\x60').join('\x60\x60')+'\x60';
  if(dialect==='sqlserver')return '['+name.replace(/]/g,']]')+']';
  return '"'+name.replace(/"/g,'""')+'"';
}
function secureHeaders(res,type){
  res.setHeader('Content-Type',type);
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}
function reply(res,status,value){
  const body=serialize(value);
  if(Buffer.byteLength(body)>4*1024*1024)return reply(res,413,{error:'Result exceeds 4 MiB. Narrow your query.'});
  secureHeaders(res,'application/json; charset=utf-8');
  res.writeHead(status);res.end(body);
}
function httpError(status,message){const e=new Error(message);e.status=status;return e;}
async function payload(req){
  let size=0;const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_REQUEST)throw httpError(413,'Request exceeds 32 KiB');
    chunks.push(chunk);
  }
  try{
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
    return value;
  }catch(_){throw httpError(400,'Expected a JSON object');}
}
function normalizeResult(result,elapsedMs,maxRows){
  const rows=Array.isArray(result.rows)?result.rows:[];
  return {
    columns:rows.length?Object.keys(rows[0]):[],
    rows:rows.slice(0,maxRows),
    truncated:rows.length>maxRows,
    shown:Math.min(rows.length,maxRows),
    rowCount:result.rowCount===undefined?rows.length:result.rowCount,
    affectedRows:result.affectedRows===undefined?null:result.affectedRows,
    command:result.command||null,
    elapsedMs
  };
}
function createWorkbench(options={}){
  if(!options.sqlApi||typeof options.sqlApi.createClient!=='function')throw new TypeError('Workbench needs the public NuBloxSQL API');
  const demo=options.demo===true;
  if(!demo&&!options.connection)throw new TypeError('Workbench needs connection options or demo mode');
  const maxRows=options.maxRows===undefined?200:options.maxRows;
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000)throw new RangeError('maxRows must be 1–1000');
  const client=options.sqlApi.createClient(demo?{dialect:'sqlite',filename:':memory:',pool:false}:options.connection);
  const token=crypto.randomBytes(32).toString('hex');
  let server,running=false,started=false,closed=false;
  async function tables(scope){
    const opts=scope?{schema:scope,database:scope}:{};
    return (await client.metadata.tables(opts)).map(function(table){
      return {name:table.name,schema:table.schema||null,database:table.database||null,type:table.type||'table'};
    });
  }
  async function lookupTable(body){
    if(typeof body.name!=='string'||!body.name||body.name.length>256||
      (body.schema!==undefined&&(typeof body.schema!=='string'||body.schema.length>256))){
      throw httpError(400,'Choose a valid table');
    }
    const found=(await tables(body.schema)).find(function(t){
      return t.name===body.name&&(body.schema===undefined||t.schema===body.schema);
    });
    if(!found)throw httpError(404,'Table is not present in the database catalogue');
    return found;
  }
  async function query(sql){
    if(running)throw httpError(409,'A query is already running');
    running=true;const begin=process.hrtime.bigint();
    try {
      const result=await client.query(sql);
      return normalizeResult(result,Number((process.hrtime.bigint()-begin)/1000000n),maxRows);
    }finally{running=false;}
  }
  async function handle(req,res){
    try {
      const port=server.address().port;
      if(req.headers.host!=='127.0.0.1:'+port)return reply(res,403,{error:'Invalid local host'});
      const url=new URL(req.url,'http://127.0.0.1:'+port);
      const assets={'/assets/app.js':[SCRIPT,'text/javascript; charset=utf-8'],
        '/assets/styles.css':[STYLE,'text/css; charset=utf-8']};
      if(req.method==='GET'&&url.pathname==='/'){
        secureHeaders(res,'text/html; charset=utf-8');
        res.end(HTML.replace('WORKBENCH_SESSION_TOKEN',token));return;
      }
      if(req.method==='GET'&&assets[url.pathname]){
        secureHeaders(res,assets[url.pathname][1]);res.end(assets[url.pathname][0]);return;
      }
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(!url.pathname.startsWith('/api/'))return reply(res,404,{error:'Not found'});
      const origin='http://127.0.0.1:'+port;
      if((req.headers.origin&&req.headers.origin!==origin)||req.headers['x-nublox-session']!==token){
        return reply(res,403,{error:'Workbench session authentication required'});
      }
      if(req.method==='GET'&&url.pathname==='/api/status'){
        return reply(res,200,{status:'connected',dialect:client.dialect,demo,maxRows,mode:'local single-session'});
      }
      if(req.method==='GET'&&url.pathname==='/api/tables'){
        return reply(res,200,{tables:await tables()});
      }
      if(req.method==='POST'&&url.pathname==='/api/columns'){
        const table=await lookupTable(await payload(req));
        const items=await client.metadata.columns(table.name,{schema:table.schema,database:table.database});
        return reply(res,200,{table:table.name,columns:items.map(c=>({
          name:c.name,dataType:c.dataType||c.nativeType||null,
          nullable:c.nullable,primaryKey:c.primaryKey===true
        }))});
      }
      if(req.method==='POST'&&url.pathname==='/api/preview'){
        const table=await lookupTable(await payload(req));
        const object=(table.schema?quote(client.dialect,table.schema)+'.':'')+quote(client.dialect,table.name);
        const statement=client.dialect==='sqlserver'?
          'SELECT TOP '+maxRows+' * FROM '+object:'SELECT * FROM '+object+' LIMIT '+maxRows;
        return reply(res,200,await query(statement));
      }
      if(req.method==='POST'&&url.pathname==='/api/query'){
        const body=await payload(req);
        if(typeof body.sql!=='string'||!body.sql.trim())throw httpError(400,'Enter a SQL statement');
        if(Buffer.byteLength(body.sql)>16384)throw httpError(413,'SQL exceeds 16 KiB');
        return reply(res,200,await query(body.sql.trim()));
      }
      return reply(res,405,{error:'Unsupported method or endpoint'});
    }catch(error){
      // Do not log statements, connection strings or credentials.
      if(!res.writableEnded)reply(res,error.status||500,{error:String(error.message||error).slice(0,400)});
    }
  }
  return Object.freeze({
    async listen(port=4277){
      if(started||closed)throw new Error('Workbench can only start once');
      started=true;
      try{
        if(demo){
          await client.query('CREATE TABLE nublox_demo (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
          await client.query("INSERT INTO nublox_demo (id,name) VALUES (1,'NuBloxSQL'),(2,'Workbench')");
        }
        await client.one('SELECT 1 AS nublox_check');
        server=http.createServer(function(req,res){void handle(req,res);});
        await new Promise(function(resolve,reject){
          server.once('error',reject);
          server.listen(port,'127.0.0.1',resolve);
        });
        return 'http://127.0.0.1:'+server.address().port+'/';
      }catch(error){await client.close();throw error;}
    },
    async close(){
      if(closed)return;closed=true;
      if(server&&server.listening)await new Promise(function(resolve,reject){
        server.close(function(error){error?reject(error):resolve();});
      });
      await client.close();
    },
    get port(){return server&&server.listening?server.address().port:null;}
  });
}
module.exports=Object.freeze({createWorkbench,quote});

'use strict';

var assert=require('assert');
var sqlserver=require('..');

async function main(){
  assert.strictEqual(sqlserver.capabilities.multipleActiveResults,false);
  assert.strictEqual(sqlserver.descriptor.supports('multipleActiveResults'),false);
  assert.strictEqual(sqlserver.plannedCapabilities.multipleActiveResults,true);

  var tds8=sqlserver.createConnection({mars:true});
  await assert.rejects(function(){return tds8.connect();},function(error){
    assert.strictEqual(error.name,'SqlServerError');
    assert.strictEqual(error.code,'NUBLOXSQL_UNSUPPORTED');
    assert.strictEqual(error.category,'unsupported');
    assert.strictEqual(error.capability,'multipleActiveResults');
    assert.match(error.message,/MARS is not implemented/);
    return true;
  });

  var tds74=sqlserver.createConnection({tdsVersion:'7.4',mars:true});
  await assert.rejects(function(){return tds74.connect();},function(error){
    assert.strictEqual(error.code,'NUBLOXSQL_UNSUPPORTED');
    assert.strictEqual(error.capability,'multipleActiveResults');
    return true;
  });

  var invalid=sqlserver.createConnection({mars:'yes'});
  await assert.rejects(function(){return invalid.connect();},/mars must be a boolean/);

  console.log('NuBloxSQL SQL Server capability honesty passed');
}

main().catch(function(error){console.error(error.stack||error);process.exitCode=1;});

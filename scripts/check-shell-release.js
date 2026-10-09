'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var root=path.join(__dirname,'..');
var shellRoot=path.join(root,'apps','shell');
var pkg=JSON.parse(fs.readFileSync(path.join(shellRoot,'package.json'),'utf8'));

assert.strictEqual(pkg.name,'@nublox/shell');
assert.strictEqual(pkg.version,'0.1.0');
assert.strictEqual(pkg.main,'index.js');
assert.strictEqual(pkg.bin.nublox,'bin/nublox.js');
assert.strictEqual(pkg.dependencies.nubloxsql,'^1.1.0');
assert.ok(fs.existsSync(path.join(shellRoot,'LICENSE')));
assert.ok(fs.existsSync(path.join(shellRoot,'README.md')));

function walk(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(function(entry){
    var full=path.join(directory,entry.name);
    if(entry.isDirectory())return walk(full);
    return entry.isFile()&&entry.name.endsWith('.js')?[full]:[];
  });
}

var production=[
  path.join(shellRoot,'index.js'),
  path.join(shellRoot,'bin','nublox.js')
].concat(walk(path.join(shellRoot,'lib')));

production.forEach(function(file){
  var source=fs.readFileSync(file,'utf8');
  assert.ok(!/lib[\\/]dialects|lib[\\/]client|lib[\\/]capabilities/.test(source),'Shell production code must not import NuBloxSQL internals: '+file);
  assert.ok(!/require\(['"](?:\.\.\/){3,}/.test(source),'Shell production code must not escape into repository internals: '+file);
});

var entry=fs.readFileSync(path.join(shellRoot,'index.js'),'utf8');
assert.match(entry,/require\('nubloxsql'\)/);

console.log('NuBlox Shell release boundary: PASS');

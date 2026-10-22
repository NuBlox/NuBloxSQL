import assert from 'node:assert/strict';

const required=new Set(['LICENSE','README.md','package.json','dist/index.js','dist/index.d.ts']);
const maxFileBytes=2*1024*1024;
const maxPackageBytes=8*1024*1024;

/** A customer must receive the full proprietarily licensed package and public API. */
export function inspectManifest(manifest){
  assert.ok(manifest&&typeof manifest==='object','Package manifest is required');
  assert.equal(manifest.name,'@nublox/driver');
  assert.match(manifest.version,/^\d+\.\d+\.\d+-dev\.\d+$/,
    'This pre-commercial gate must never silently promote a production release');
  assert.equal(manifest.type,'module');
  assert.equal(manifest.license,'SEE LICENSE IN LICENSE');
  assert.equal(manifest.engines?.node,'>=22');
  assert.equal(manifest.main,'./dist/index.js');
  assert.equal(manifest.types,'./dist/index.d.ts');
  assert.equal(manifest.exports?.['.']?.types,'./dist/index.d.ts');
  assert.equal(manifest.exports?.['.']?.default,'./dist/index.js');
  for(const group of ['dependencies','optionalDependencies','peerDependencies','bundledDependencies']){
    const listed=manifest[group];
    assert.ok(!listed||(Array.isArray(listed)?listed.length===0:Object.keys(listed).length===0),
      'Third-party runtime dependency requires a separate provenance/security review: '+group);
  }
  for(const script of ['preinstall','install','postinstall','prepack','postpack','prepare','prepublish','prepublishOnly']){
    assert.ok(!manifest.scripts?.[script],'No npm install/publish lifecycle hooks are permitted: '+script);
  }
}

/** Validate entries from npm pack --json --dry-run. */
export function inspectPacklist(files){
  assert.ok(Array.isArray(files)&&files.length>0,'npm pack file inventory is required');
  const actual=new Set();
  let total=0;
  for(const file of files){
    assert.ok(file&&typeof file.path==='string','Invalid npm pack file entry');
    assert.ok(!actual.has(file.path),'Duplicate npm pack path: '+file.path);
    actual.add(file.path);
    const safe=required.has(file.path)||
      /^dist\/[A-Za-z0-9_/-]+\.(?:js|d\.ts)$/.test(file.path);
    assert.ok(safe,'Unexpected private, fixture, build or unpublished file: '+file.path);
    assert.ok(Number.isSafeInteger(file.size)&&file.size>=0&&file.size<=maxFileBytes,
      'Published file exceeds the bounded package limit: '+file.path);
    total+=file.size;
  }
  for(const path of required)assert.ok(actual.has(path),'Required package file missing: '+path);
  assert.ok(total<=maxPackageBytes,'Published package exceeds the bounded total file size');
  return {fileCount:files.length,totalBytes:total};
}

/** Defence-in-depth boundary: dist may depend only on Node builtins and itself. */
export function inspectRuntimeImports(source,filename='dist/index.js'){
  assert.equal(typeof source,'string');
  const expressions=[
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g
  ];
  for(const regex of expressions){
    for(const match of source.matchAll(regex)){
      const specifier=match[1];
      assert.ok(specifier.startsWith('node:')||specifier.startsWith('./')||
                specifier.startsWith('../'),
        'Unexpected third-party runtime import in '+filename+': '+specifier);
    }
  }
}

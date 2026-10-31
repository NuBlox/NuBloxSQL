import assert from 'node:assert/strict';

/** Fail-closed policy for the *development workspace* dependency graph.
 * Updates must be reviewed rather than silently enlarging the build-tool
 * supply chain. No runtime dependency is added to the shipped Driver. */
const expectedRegistryPackages=[
  '@types/node','typescript','undici-types'
];
const own=(value)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value);
const same=(a,b)=>assert.deepEqual(a,b);

function exactIntegrity(value){
  assert.equal(typeof value,'string','Missing package integrity digest');
  assert.ok(value.startsWith('sha512-'),'Expected sha512 tarball digest');
  const encoded=value.slice(7);
  const bytes=Buffer.from(encoded,'base64');
  assert.equal(bytes.length,64,'Expected 512-bit integrity digest');
  assert.equal(bytes.toString('base64'),encoded,'Non-canonical integrity digest');
}
function registryArtifact(name,entry){
  assert.equal(typeof entry.version,'string','Missing resolved version: '+name);
  assert.match(entry.version,/^\\d+\\.\\d+\\.\\d+$/,
    'Resolved version must be exact: '+name);
  const tarball=new URL(entry.resolved);
  assert.equal(tarball.protocol,'https:','Registry must use HTTPS: '+name);
  assert.equal(tarball.host,'registry.npmjs.org',
    'Unexpected dependency registry: '+name);
  assert.equal(tarball.username,'');
  assert.equal(tarball.password,'');
  assert.equal(tarball.search,'');
  assert.equal(tarball.hash,'');
  const basename=name.split('/').at(-1);
  assert.equal(tarball.pathname,
    '/'+name+'/-/'+basename+'-'+entry.version+'.tgz',
    'Unexpected tarball identity: '+name);
  exactIntegrity(entry.integrity);
  assert.equal(entry.dev,true,'Workspace dependency must be dev-only: '+name);
  assert.equal(entry.hasInstallScript,undefined,
    'No dependency install-time script may be introduced: '+name);
}

export function inspectWorkspaceLock(rootManifest,driverManifest,lock){
  assert.ok(own(rootManifest)&&own(driverManifest)&&own(lock));
  assert.equal(lock.lockfileVersion,3,'Expected npm lockfile v3');
  assert.equal(lock.requires,true);
  assert.equal(rootManifest.private,true);
  assert.equal(rootManifest.name,'nubloxsql-driver-workspace');
  same(rootManifest.workspaces,['packages/*']);
  assert.equal(driverManifest.name,'@nublox/driver');
  assert.equal(driverManifest.version,'0.1.0-dev.0');
  same(driverManifest.devDependencies,{
    typescript:'5.9.3','@types/node':'^22.0.0'
  });
  for(const key of ['dependencies','optionalDependencies','peerDependencies']){
    assert.equal(rootManifest[key],undefined,'Root runtime dependencies require review');
    assert.equal(driverManifest[key],undefined,'Driver runtime dependencies require review');
  }
  assert.equal(lock.name,rootManifest.name);
  const packages=lock.packages;
  assert.ok(own(packages),'Missing package inventory');
  same(Object.keys(packages).sort(),[
    '','packages/driver','node_modules/@nublox/driver',
    ...expectedRegistryPackages.map(n=>'node_modules/'+n)
  ].sort());
  same(packages[''].workspaces,rootManifest.workspaces);
  assert.equal(packages[''].name,rootManifest.name);
  assert.equal(packages[''].engines?.node,rootManifest.engines.node);
  const workspace=packages['packages/driver'];
  assert.equal(workspace.name,driverManifest.name);
  assert.equal(workspace.version,driverManifest.version);
  assert.equal(workspace.license,driverManifest.license);
  same(workspace.devDependencies,driverManifest.devDependencies);
  assert.equal(workspace.engines?.node,driverManifest.engines.node);
  same(packages['node_modules/@nublox/driver'],{
    resolved:'packages/driver',link:true
  });
  for(const name of expectedRegistryPackages)
    registryArtifact(name,packages['node_modules/'+name]);
  assert.equal(packages['node_modules/typescript'].version,
    driverManifest.devDependencies.typescript);
  assert.match(packages['node_modules/@types/node'].version,/^22\\./);
  same(packages['node_modules/@types/node'].dependencies,{
    'undici-types':'~6.21.0'
  });
  assert.equal(packages['node_modules/undici-types'].version,'6.21.0');

  return Object.freeze({
    kind:'workspace-dependency-lock',
    status:'passed',lockfileVersion:3,
    workspaces:1,registryPackages:expectedRegistryPackages.length,
    installedVersions:Object.freeze(Object.fromEntries(
      expectedRegistryPackages.map(name=>
        [name,packages['node_modules/'+name].version])
    ))
  });
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectWorkspaceLock} from './workspace-lock-core.mjs';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifests=()=>[
  read('../../package.json'),
  read('../../packages/driver/package.json'),
  read('../../package-lock.json')
];
const clone=value=>structuredClone(value);
const reject=(mutate,reason)=>{
  const args=manifests().map(clone);
  mutate(...args);
  assert.throws(()=>inspectWorkspaceLock(...args),reason);
};

test('committed workspace lock is a single, integrity-checked, dev-only build graph',()=>{
  const result=inspectWorkspaceLock(...manifests());
  assert.equal(result.kind,'workspace-dependency-lock');
  assert.equal(result.status,'passed');
  assert.equal(result.lockfileVersion,3);
  assert.equal(result.registryPackages,3);
  assert.equal(result.installedVersions.typescript,'5.9.3');
  assert.ok(Object.isFrozen(result));
});

test('lock rejects extra registries and runtime packages',()=>{
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/unreviewed']={
      version:'1.0.0',
      resolved:'https://registry.npmjs.org/unreviewed/-/unreviewed-1.0.0.tgz',
      integrity:'sha512-'+Buffer.alloc(64).toString('base64'),
      dev:true
    };
  });
  reject((root)=>{root.dependencies={mysql2:'3.24.6'};});
  reject((_root,driver)=>{driver.dependencies={mysql2:'3.24.6'};});
});

test('lock rejects changed, missing, or forged tarball integrity',()=>{
  reject((_root,_driver,lock)=>{
    delete lock.packages['node_modules/typescript'].integrity;
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/typescript'].integrity='sha512-not-a-digest';
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/undici-types'].resolved=
      'https://registry.npmjs.org.evil.example/undici-types/-/undici-types-6.21.0.tgz';
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/@types/node'].resolved=
      'http://registry.npmjs.org/@types/node/-/node-22.20.5.tgz';
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/typescript'].resolved=
      'https://registry.npmjs.org/typescript/-/typescript-5.8.0.tgz';
  });
});

test('lock rejects workspace symlink and manifest drift',()=>{
  reject((_root,_driver,lock)=>{lock.packages['node_modules/@nublox/driver'].link=false;});
  reject((_root,driver)=>{driver.devDependencies.typescript='5.9.4';});
  reject((_root,_driver,lock)=>{
    lock.packages['packages/driver'].version='0.1.0-dev.1';
  });
  reject((root)=>{root.workspaces=['packages/*','unreviewed/*'];});
});

test('lock rejects unreviewed install scripts, build tools and major-version changes',()=>{
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/typescript'].hasInstallScript=true;
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/@types/node'].version='24.0.0';
  });
  reject((_root,_driver,lock)=>{
    lock.packages['node_modules/undici-types'].version='6.22.0';
  });
});

'use strict';

// Repository-wide static import qualification. Node.js supports multiple
// module styles; guard only literal CommonJS relative requires in runtime
// files, where the target must always exist in the published source tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function walk(dir) {
  let result = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (entry.isDirectory() && entry.name !== 'test' && entry.name !== 'fixtures') result.push(...walk(path.join(dir,entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(path.join(dir, entry.name));
  }
  return result;
}
const sources = [
  path.join(root, 'index.js'),
  ...walk(path.join(root, 'lib')),
  ...walk(path.join(root, 'apps'))
];
let importCount = 0, applicationImports = 0;
for (const source of sources) {
  const relativeFile = path.relative(root,source).replace(/\\/g,'/');
  const content = fs.readFileSync(source,'utf8');
  const imports = /\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
  let match;
  while ((match = imports.exec(content)) !== null) {
    const candidate = path.resolve(path.dirname(source),match[2]);
    let resolved;
    try { resolved = require.resolve(candidate); }
    catch (error) {
      throw new Error('Broken static require in ' + relativeFile + ': ' + match[2] +
        ' (' + error.message + ')');
    }
    assert.ok(resolved.startsWith(root + path.sep),
      'local runtime require escapes repository: ' + relativeFile);
    const target = path.relative(root,resolved).replace(/\\/g,'/');
    importCount++;
    if (relativeFile.startsWith('lib/')) {
      assert.ok(!target.startsWith('apps/'),
        'driver cannot import an application: ' + relativeFile + ' -> ' + target);
    }
    if (relativeFile.startsWith('apps/')) {
      applicationImports++;
      assert.ok(!target.startsWith('lib/'),
        'professional tools may consume only the public driver API: ' +
        relativeFile + ' -> ' + target);
    }
    if (relativeFile.startsWith('lib/catalog/')) {
      assert.ok(!target.startsWith('lib/client/') && !target.startsWith('lib/jobs/'),
        'catalogue must not depend on runtime client or job execution: ' +
        relativeFile + ' -> ' + target);
    }
  }
}
assert.ok(importCount > 100, 'unexpectedly few runtime imports inspected');
assert.ok(applicationImports > 0, 'application dependencies were not inspected');
console.log('NuBloxSQL runtime/import and product boundaries: PASS (' +
  sources.length + ' runtime files, ' + importCount + ' relative imports)');

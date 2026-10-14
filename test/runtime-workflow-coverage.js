'use strict';

// Shared adapter changes affect all native SQL engines. Guard GitHub path
// filters so vendor CI cannot silently skip a shared runtime modification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflows = [
  'mysql-cleanroom.yml', 'postgresql-dialect.yml',
  'sqlite-dialect.yml', 'sqlserver.yml'
];
for (const workflow of workflows) {
  const file = path.join(root,'.github','workflows',workflow);
  const text = fs.readFileSync(file,'utf8');
  assert.ok(text.includes('pull_request:'), workflow + ' must check pull requests');
  assert.ok(text.includes('push:'), workflow + ' must check merged main');
  const occurrences = text.split("      - 'lib/runtime/**'").length - 1;
  assert.equal(occurrences,2,
    workflow + ' must include lib/runtime/** in both PR and main push paths');
}
console.log('NuBloxSQL native adapter runtime live-dialect CI path gates: PASS');

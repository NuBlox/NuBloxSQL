'use strict';

// Regression protection for the three-product boundary and requirements source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const model = require('../docs/product/product-surface-model.json');
const professions = require('../docs/product/database-profession-work-register.json');

assert.equal(model.schemaVersion, 1);
assert.equal(model.kind, 'nubloxsql-product-surface-model');
assert.equal(model.authority, 'docs/product/BLUEPRINT.md');
assert.equal(model.requirements, 'docs/product/database-profession-work-register.json');
assert.deepEqual(model.products.map(product => product.id), ['driver', 'shell', 'workbench']);
assert.equal(model.products[0].kind, 'universal-database-driver');
assert.ok(model.products[0].owns.includes('native-query-model-extensions'));
assert.ok(model.products[0].mustNotOwn.includes('force-non-sql-engines-through-sql'));
assert.deepEqual(model.products.map(product => product.consumes), [[], ['driver'], ['driver']]);
for (const product of model.products) {
  assert.equal(typeof product.name, 'string');
  assert.equal(fs.statSync(path.join(root, product.entry)).isFile(), true, product.entry);
  assert.ok(product.owns.length > 0);
  assert.ok(product.mustNotOwn.length > 0);
}
assert.deepEqual(model.workModel.streams, ['governance', 'delivery']);
assert.equal(model.workModel.unit, 'activity');
assert.equal(model.workModel.evidence, 'work-product');
assert.equal(model.workModel.phasesSource, model.requirements);
assert.equal(professions.families.length, 18);
assert.equal(professions.activities.length, 40);
assert.equal(professions.families.reduce((count, family) => count + family.jobTitles.length, 0), 240);
assert.equal(professions.lifecyclePhases.length, 11);
const phases = new Set(professions.lifecyclePhases);
for (const activity of professions.activities) {
  assert.ok(model.workModel.streams.includes(activity.workstream), activity.id);
  assert.ok(activity.workProducts.length > 0, activity.id);
  assert.ok(activity.requiredCapabilityAreas.length > 0, activity.id);
  assert.ok(activity.lifecyclePhases.every(phase => phases.has(phase)), activity.id);
}
for (const phase of phases) {
  assert.ok(professions.activities.some(activity => activity.lifecyclePhases.includes(phase)), phase);
}
for (const file of ['README.md','docs/product/BLUEPRINT.md','docs/product/PRODUCT-SURFACES.md']) {
  const content = fs.readFileSync(path.join(root,file),'utf8');
  assert.match(content,/NuBloxSQL Shell/);
  assert.match(content,/NuBloxSQL Workbench/);
  assert.match(content,/driver/i);
}
console.log('NuBloxSQL three-product surface architecture: PASS');

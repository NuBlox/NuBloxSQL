'use strict';

// Internal product-design register: validates traceability and forbids
// conflating professional titles with runtime engine/authorization claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const model = JSON.parse(fs.readFileSync(
  path.join(root, 'docs/product/database-profession-work-register.json'), 'utf8'
));
const coverage = fs.readFileSync(path.join(root, 'docs/product/CAPABILITY-REGISTER.md'), 'utf8');
const blueprint = fs.readFileSync(path.join(root, 'docs/product/BLUEPRINT.md'), 'utf8');
const guide = fs.readFileSync(path.join(root, 'docs/product/PROFESSION-LED-REQUIREMENTS.md'), 'utf8');

const unique = (items, message) => assert.equal(new Set(items).size, items.length, message);
assert.equal(model.schemaVersion, 1);
assert.equal(model.kind, 'database-profession-work-requirements');
assert.equal(model.status, 'design-input-not-runtime-authorization');
assert.match(model.boundary, /not DBMS roles/i);
assert.equal(model.tracks.length, 6);
assert.deepEqual(model.tracks.map(track => track.id), ['A','B','C','D','E','F']);
assert.equal(model.families.length, 18);
assert.equal(model.activities.length, 40);
assert.equal(model.competencyAreas.length, 13);
assert.equal(model.seniorityFacets.length, 7);
const canonicalPhases = [
  'Select','Install','Initialize','Discover','Establish','Build',
  'Use','Understand','Operate','Change','Retire'
];
const canonicalDomains = [
  'engine-lifecycle','connectivity-runtime','sql-language','database-intelligence',
  'database-engineering','database-administration','database-operations','portability-governance'
];
assert.deepEqual(model.lifecyclePhases, canonicalPhases);
assert.deepEqual(model.productDomainIds, canonicalDomains);
for (const phase of canonicalPhases) assert.ok(blueprint.includes(phase), 'blueprint lacks '+phase);

const capabilityNames = new Set(coverage.split('\n').filter(line => /^\| [^|]+ \| (?:Strong|Established|Partial|Gap)/.test(line))
  .map(line => line.split('|')[1].trim()));
assert.ok(capabilityNames.size > 35);

unique(model.families.map(family => family.id), 'family identities must be unique');
unique(model.activities.map(activity => activity.id), 'activity identities must be unique');
unique(model.competencyAreas.map(area => area.id), 'competency identities must be unique');
unique(model.seniorityFacets, 'seniority facets must be distinct');
unique(model.technologySpecializations.map(s => s.id), 'technology identities must be unique');
const titles = [];
const activities = new Map(model.activities.map(a => [a.id, a]));
const competencies = new Set(model.competencyAreas.map(c => c.id));
const domains = new Set(model.productDomainIds);
const phases = new Set(model.lifecyclePhases);
const usedActivities = new Set();
for (const family of model.families) {
  assert.match(family.id, /^family-\d{2}$/);
  assert.ok(model.tracks.some(track => track.id === family.track));
  assert.ok(typeof family.name === 'string' && family.name.length > 4);
  assert.ok(family.jobTitles.length >= 8);
  unique(family.jobTitles, 'duplicate title inside '+family.id);
  unique(family.activityIds, 'duplicate activity inside '+family.id);
  for (const title of family.jobTitles) {
    assert.ok(typeof title === 'string' && title.trim() === title && title.length >= 4);
    titles.push(title);
  }
  assert.ok(family.activityIds.length >= 4);
  for (const id of family.activityIds) {
    assert.ok(activities.has(id), 'unmapped activity '+id);
    usedActivities.add(id);
  }
}
assert.equal(titles.length, 240);
assert.equal(new Set(titles).size, 239); // Cross-family 'Data Warehouse Architect' overlap is intentional.
assert.equal(usedActivities.size, activities.size, 'an activity without any associated family');
for (const activity of model.activities) {
  assert.match(activity.id, /^a\d{2}$/);
  assert.ok(['governance','delivery'].includes(activity.workstream));
  assert.ok(activity.productDomains.length >= 1 && activity.lifecyclePhases.length >= 1);
  assert.ok(activity.workProducts.length >= 2);
  assert.ok(activity.requiredCapabilityAreas.length >= 1);
  assert.ok(activity.competencyIds.length >= 1);
  for (const id of activity.productDomains) assert.ok(domains.has(id), 'unrecognized product domain '+id);
  for (const phase of activity.lifecyclePhases) assert.ok(phases.has(phase), 'unrecognized lifecycle phase '+phase);
  for (const cap of activity.requiredCapabilityAreas) {
    assert.ok(capabilityNames.has(cap), 'unknown product capability area '+cap);
  }
  for (const competency of activity.competencyIds) assert.ok(competencies.has(competency));
  for (const output of activity.workProducts) assert.ok(output && typeof output === 'string');
}
for (const phase of phases) {
  assert.ok(model.activities.some(activity => activity.lifecyclePhases.includes(phase)), 'uncovered phase '+phase);
}
for (const domain of domains) {
  assert.ok(model.activities.some(activity => activity.productDomains.includes(domain)), 'uncovered domain '+domain);
}
for (const track of model.tracks) assert.equal(model.families.filter(f => f.track===track.id).length, 3);
const executable = model.technologySpecializations.filter(spec => spec.runtimeQualification==='supported-engine');
assert.deepEqual(executable.map(spec => spec.id), ['mysql','postgresql','sqlite','sqlserver']);
assert.equal(model.technologySpecializations.length, 18);
assert.ok(model.technologySpecializations.filter(spec => spec.runtimeQualification==='reference-only-not-qualified').length===14);
for (const spec of model.technologySpecializations) assert.ok(typeof spec.example === 'string' && spec.example);
assert.match(guide, /not permission/i);
assert.match(guide, /database-profession-work-register\.json/);
console.log('NuBloxSQL profession requirements: 18 families, 240 title entries, 40 activities and capability traceability: PASS');

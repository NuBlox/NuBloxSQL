/**
 * Restrict the customer-facing package root to an explicitly reviewed set of
 * public exports. Parsing TypeScript syntax (rather than regex strings) also
 * detects aliases, export *, default exports and accidentally exposed values.
 *
 * Types are separately checked by a strict, compiled consumer contract.
 * This is an engineering preview gate, NOT semantic-versioning certification.
 */
import assert from 'node:assert/strict';
import ts from 'typescript';

export function extractPublicExports(source){
  assert.equal(typeof source,'string');
  const file=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true,
    ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length,0,'Public entrypoint must parse');
  const entries=[];
  const names=new Set();
  for(const statement of file.statements){
    if(ts.isExportDeclaration(statement)){
      assert.ok(statement.moduleSpecifier&&
        ts.isStringLiteral(statement.moduleSpecifier)&&
        statement.exportClause&&ts.isNamedExports(statement.exportClause),
      'Only explicitly named module exports are allowed');
      const from=statement.moduleSpecifier.text;
      assert.match(from,/^\.\/[A-Za-z0-9_/-]+\.js$/,
        'Public exports must resolve to internal compiled modules');
      for(const element of statement.exportClause.elements){
        const name=element.name.text;
        const imported=element.propertyName?.text??name;
        assert.ok(!names.has(name),'Duplicate public export: '+name);
        names.add(name);
        entries.push({
          name,kind:statement.isTypeOnly||element.isTypeOnly?'type':'value',
          from,imported
        });
      }
    }else{
      assert.ok(!ts.isExportAssignment(statement)&&
        !statement.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword||
          x.kind===ts.SyntaxKind.DefaultKeyword),
      'Root package may expose exports only through named module declarations');
    }
  }
  return entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
}

export function validatePublicApi({source,baseline,manifest}){
  assert.ok(baseline&&baseline.schemaVersion===1&&
    baseline.package==='@nublox/driver'&&
    baseline.policy==='exact-reviewed-public-exports'&&
    Array.isArray(baseline.exports)&&baseline.exports.length>=1,
    'Valid public contract baseline is required');
  assert.equal(manifest?.name,baseline.package);
  assert.equal(manifest?.version,baseline.releaseLine,
    'Changing the preview version requires a separately reviewed API baseline');
  assert.deepEqual(Object.keys(manifest.exports??{}),['.'],
    'Unreviewed package subpath exports are forbidden');
  const actual=extractPublicExports(source);
  assert.deepEqual(actual,baseline.exports,
    'Public exports changed: perform compatibility review and update baseline explicitly');
  return Object.freeze({
    schemaVersion:1,kind:'public-api-contract',status:'passed',
    package:baseline.package,version:manifest.version,
    exports:actual.length,typeExports:actual.filter(x=>x.kind==='type').length,
    runtimeExports:actual.filter(x=>x.kind==='value').length
  });
}

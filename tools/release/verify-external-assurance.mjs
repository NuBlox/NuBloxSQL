/** Preview-only assurance pack integrity: confirms structure and local sources;
 * neither a completed independent audit nor commercial release approval.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectExternalAssuranceIntake} from './external-assurance-core.mjs';
import {inspectCommercialDecision} from './commercial-decision-core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const packageFile=read('packages/driver/package.json');
const manifest={name:packageFile.name,version:packageFile.version};
const blocked=read('docs/release/mysql-commercial-decision.json');
inspectCommercialDecision(blocked,manifest);
const report=inspectExternalAssuranceIntake(
  read('docs/assurance/external-assurance-intake.json'),
  blocked,manifest,{sourceExists:path=>existsSync(resolve(root,path))}
);
const docs=[
  'docs/assurance/README.md',
  'docs/assurance/ASSESSMENT-SCOPE.md',
  'docs/assurance/INDEPENDENT-TEST-PLAN.md',
  'docs/assurance/REQUEST-FOR-QUOTATION.md',
  'docs/assurance/EVIDENCE-AND-FINDINGS.md',
  'docs/assurance/RELEASE-ACCEPTANCE.md'
];
for(const file of docs){
  const source=readFileSync(resolve(root,file),'utf8');
  assert.ok(source.length>800,'Incomplete assurance document: '+file);
  for(const match of source.matchAll(/\]\(([^)]+)\)/g)){
    const dest=match[1].split('#')[0];
    if(!dest||/^(?:https?:|mailto:)/.test(dest))continue;
    assert.ok(existsSync(resolve(root,dirname(file),dest)),
      'Broken assurance document link: '+file+' -> '+dest);
  }
}
const dest=resolve(root,'artifacts/release/assurance-intake-check.json');
mkdirSync(dirname(dest),{recursive:true});
writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));

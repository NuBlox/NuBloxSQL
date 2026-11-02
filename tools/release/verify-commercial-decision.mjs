/** Always succeed only for an explicitly blocked preview; never authorise release. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectCommercialDecision} from './commercial-decision-core.mjs';

const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--require-production'))throw Error('Unknown commercial decision option');
const root=fileURLToPath(new URL('../../',import.meta.url));
const decision=JSON.parse(readFileSync(resolve(root,'docs/release/mysql-commercial-decision.json'),'utf8'));
const manifest=JSON.parse(readFileSync(resolve(root,'packages/driver/package.json'),'utf8'));
const report=inspectCommercialDecision(decision,
  {name:manifest.name,version:manifest.version},
  {requireProduction:args.includes('--require-production')});
const dest=resolve(root,'artifacts/release/commercial-decision.json');
mkdirSync(resolve(root,'artifacts/release'),{recursive:true});
writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));

#!/usr/bin/env node
/** Aggregate independently recorded concurrent comparison reports.
 * Validate shape and comparability before emitting credential-free evidence.
 * Diagnostic only; no performance winner or production claim is authorised.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzeReports} from './comparison/cross-run.mjs';

const files=process.argv.slice(2);
if(files.length<2||files.length>64)
  throw Error('Supply between 2 and 64 independent comparison report files');
const reports=files.map(file=>{
  const json=readFileSync(resolve(file),'utf8');
  if(json.length>1024*1024)
    throw Error('Comparison report exceeds bounded input size');
  return JSON.parse(json);
});
const summary=analyzeReports(reports);
const directory=resolve('artifacts/qualification');
mkdirSync(directory,{recursive:true});
const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^A-Za-z0-9-]/g,'');
const destination=resolve(directory,`comparison-analysis-${runId}-${Date.now()}.json`);
writeFileSync(destination,JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:destination,analysis:summary},null,2));

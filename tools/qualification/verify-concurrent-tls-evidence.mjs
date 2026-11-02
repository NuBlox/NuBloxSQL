#!/usr/bin/env node
/** Validate exactly two original same-run TLS comparisons in a separate job. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {selectTlsComparisonReports,validateTlsComparisonReports}
  from './comparison/tls-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Evidence artifact directory required');
  const directory=resolve(process.argv[2]);
  const runId=process.env.GITHUB_RUN_ID;
  const filenames=selectTlsComparisonReports(readdirSync(directory),runId);
  const reports=filenames.map(filename=>{
    const path=join(directory,filename);
    assert.ok(statSync(path).isFile()&&statSync(path).size<=1024*1024,
      'Unbounded or missing benchmark report');
    return JSON.parse(readFileSync(path,'utf8'));
  });
  const result=validateTlsComparisonReports(reports,{
    revision:process.env.GITHUB_SHA,runId
  });
  const dir=resolve('artifacts/qualification-matrix');
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'mysql-verified-tls-comparison-'+runId+'.json'),
    JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result));
}catch{
  // Never include raw report fields, exception messages or SQL in CI logs.
  console.error('Independent MySQL verified-TLS comparison evidence failed');
  process.exitCode=1;
}

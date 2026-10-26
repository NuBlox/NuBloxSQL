#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {platform,arch,cpus} from 'node:os';
import {profilePacketHeaders,comparePacketHeaderProfiles} from './framing-hot.mjs';

const [baselineDir,candidateDir,baselineRevision,candidateRevision]=process.argv.slice(2);
if(!baselineDir||!candidateDir||!baselineRevision||!candidateRevision||
  process.argv.length!==6)
  throw Error('Pass base directory, candidate directory and their exact revisions');

async function load(root){
  const url=pathToFileURL(resolve(root,'packages/driver/dist/vendors/mysql/protocol/framing.js'));
  const {PacketStream}=await import(url.href);
  return PacketStream;
}
const base=await load(baselineDir);
const candidate=await load(candidateDir);
const options={iterations:500,rounds:6,packetCount:256};
const reports=[];
for(const Type of [base,candidate,candidate,base]){
  reports.push(await profilePacketHeaders(Type,options));
}
const comparison=comparePacketHeaderProfiles(reports,{
  baselineRevision,candidateRevision
});
const report={
  schemaVersion:1,
  createdAt:new Date().toISOString(),
  environment:{node:process.version,platform:platform(),arch:arch(),
    cpuCount:cpus().length},
  configuration:options,
  comparison,reports
};
const dest=resolve('artifacts/qualification');
mkdirSync(dest,{recursive:true});
const file=resolve(dest,`mysql-frame-header-ab-${Date.now()}.json`);
writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:file,comparison},null,2));

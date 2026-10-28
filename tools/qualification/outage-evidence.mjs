/**
 * Pure, fail-closed evidence policy for repeated destructive MySQL restarts.
 * No database connections, Docker calls or secret-bearing payloads.
 */
import {integerOption} from './metrics.mjs';

export function parseOutageOptions(args){
  if(args.length!==1||!/^--cycles=[0-9]+$/.test(args[0]))
    throw new Error('Require exactly one --cycles=N option');
  return Object.freeze({cycles:integerOption(args[0].slice(9),{
    name:'cycles',min:2,max:12
  }),poolSize:2,borrowers:12});
}
const validObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const check=(yes,message)=>{if(!yes)throw new Error('Repeated outage evidence invalid: '+message);};
const versionMatches=(actual,version)=>typeof actual==='string'&&
  (actual===version||actual.startsWith(version+'-'));

export function validateOutageEvidence(report,{version,revision,minimumCycles=2}){
  check(validObject(report)&&report.schemaVersion===1&&
    report.kind==='mysql-repeated-outages'&&report.status==='passed'&&
    report.failureCode===null,'run status');
  check(/^[0-9a-f]{40}$/.test(revision??'')&&report.revision===revision,
    'commit revision');
  const e=report.environment;
  check(validObject(e)&&e.image==='mysql:'+version&&
    versionMatches(e.serverVersion,version)&&e.platform==='linux'&&
    e.arch==='x64'&&/^v22\./.test(e.node??'')&&e.ci===true,
    'pinned CI fixture');
  check(validObject(report.configuration)&&
    natural(report.configuration.cycles)&&
    report.configuration.cycles>=minimumCycles&&
    report.configuration.cycles<=12&&
    report.configuration.poolSize===2&&report.configuration.borrowers===12,
    'run configuration');
  check(Array.isArray(report.cycles)&&
    report.cycles.length===report.configuration.cycles,'cycle count');
  for(const [index,cycle] of report.cycles.entries()){
    check(cycle.number===index+1&&cycle.status==='passed'&&
      validObject(cycle.pressureBefore)&&validObject(cycle.pressureAfter),
      'cycle ordering or completeness');
    for(const pressure of [cycle.pressureBefore,cycle.pressureAfter]){
      check(pressure.completed===12&&pressure.peakPending>=1&&
        pressure.peakSize<=2&&pressure.peakSize>=1&&
        pressure.sizeAfterClose===0&&pressure.pendingAfterClose===0,
        'pool pressure and disposal');
    }
    const recovery=cycle.recovery;
    check(validObject(recovery)&&recovery.status==='passed'&&
      recovery.revision===revision&&recovery.serverVersion===version&&
      recovery.inFlightExecutions===1&&
      recovery.expectedInterrupted===true&&recovery.preparedRevoked===true&&
      recovery.oldSessionRetired===true&&recovery.poolReconnected===true&&
      recovery.exactlyOnce===true&&recovery.poolClosed===0,
      'crash recovery and SQL replay');
    check(natural(cycle.rssAfterBytes)&&natural(cycle.heapAfterBytes),
      'resource snapshots');
  }
  return Object.freeze({schemaVersion:1,kind:report.kind,status:'passed',
    revision,version,cycles:report.cycles.length,
    verifiedPressurePasses:report.cycles.length*2,
    verifiedRestarts:report.cycles.length});
}

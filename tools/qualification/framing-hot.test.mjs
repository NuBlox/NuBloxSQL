import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PacketStream} from '../../packages/driver/dist/vendors/mysql/protocol/framing.js';
import {profilePacketHeaders,comparePacketHeaderProfiles} from './framing-hot.mjs';

test('profile uses real packet decoder and verifies every logical message',{timeout:5000},async()=>{
  const report=await profilePacketHeaders(PacketStream,{
    iterations:8,rounds:2,packetCount:16
  });
  assert.equal(report.length,2);
  for(const trial of report){
    assert.equal(trial.packetCount,16);
    assert.equal(trial.iterations,8);
    assert.ok(trial.p50FramesPerSecond>0);
    assert.ok(trial.p50Ms>=0);
  }
  const comparison=comparePacketHeaderProfiles([
    report,report,report,report
  ],{baselineRevision:'old',candidateRevision:'new'});
  assert.equal(comparison.candidateToBaselineRatio,1);
  assert.equal(comparison.roundsPerRun,2);
});

test('frame profile refuses invalid input without allocating unbounded work',async()=>{
  for(const config of [
    {iterations:1},{iterations:2001},{rounds:1},{rounds:9},
    {packetCount:0},{packetCount:513}
  ]){
    await assert.rejects(profilePacketHeaders(PacketStream,config),/Invalid framing profile/);
  }
  await assert.rejects(profilePacketHeaders(null),/Invalid MySQL frame profiler/);
});

test('comparison detects incomplete or mismatched profiles and revision identities',()=>{
  const mk=(revision,pps)=>[
    {round:1,packetCount:16,iterations:8,p50FramesPerSecond:pps},
    {round:2,packetCount:16,iterations:8,p50FramesPerSecond:pps}
  ];
  const values=[mk('base',100),mk('new',150),mk('new',150),mk('base',100)];
  assert.equal(comparePacketHeaderProfiles(values,{
    baselineRevision:'aaa',candidateRevision:'bbb'
  }).candidateToBaselineRatio,1.5);
  assert.throws(()=>comparePacketHeaderProfiles(values.slice(1),{
    baselineRevision:'aaa',candidateRevision:'bbb'
  }),/Invalid packet header comparison/);
  assert.throws(()=>comparePacketHeaderProfiles(values,{
    baselineRevision:'aaa',candidateRevision:'aaa'
  }),/Invalid packet header comparison/);
  const malformed=structuredClone(values);
  malformed[2][1].packetCount=32;
  assert.throws(()=>comparePacketHeaderProfiles(malformed,{
    baselineRevision:'aaa',candidateRevision:'bbb'
  }),/Mismatched or malformed/);
  const invalid=structuredClone(values);
  invalid[1][1].p50FramesPerSecond=NaN;
  assert.throws(()=>comparePacketHeaderProfiles(invalid,{
    baselineRevision:'aaa',candidateRevision:'bbb'
  }),/Mismatched or malformed/);
});

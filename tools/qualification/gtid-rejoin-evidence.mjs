/**
 * Independent, fail-closed safety contract for a recovered former primary.
 * Reuses the previously proven fenced GTID promotion invariants, then
 * requires persistent read-only startup and GTID reverse replication.
 * No Docker, credentials, SQL text or server identifiers.
 */
import assert from 'node:assert/strict';
import {validateFencedPromotionEvidence} from './gtid-promotion-evidence.mjs';

export function validateFormerPrimaryRejoinEvidence(report,context={}){
  assert.equal(report?.kind,'mysql-gtid-former-primary-rejoin');
  const base=validateFencedPromotionEvidence({
    ...report,kind:'mysql-gtid-fenced-promotion'
  },context);
  const r=report.rejoin;
  assert.ok(r&&typeof r==='object'&&
    r.persistedSuperReadOnlyBeforeCrash===true&&
    r.restartHealthy===true&&
    r.persistedSuperReadOnlyAfterRestart===true&&
    r.rejectedOldPrimaryWrite===true&&
    r.oldPrimaryWriteAttempts===1&&
    r.noUnexpectedOldPrimaryWrites===true&&
    r.reverseAutoPosition===true&&r.receiverRunning===true&&
    r.applierRunning===true&&r.reverseGtidCatchupResult===0&&
    r.originalTokenCount===1&&r.promotedTokenCount===1&&
    r.superReadOnlyAfterCatchup===true&&
    r.oldPrimaryStillReadOnly===true&&
    r.promotedPrimaryStillWritable===true,
    'Recovered source must restart fenced, refuse client writes and apply promoted GTIDs');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-gtid-rejoin-decision',
    status:'passed',revision:base.revision,runId:base.runId,
    version:base.version,primaryFenced:true,
    formerPrimaryRestartedReadOnly:true,reverseReplicationCaughtUp:true,
    originalTokenCount:1,promotedTokenCount:1,
    formerPrimaryRejectedWrites:1,
    originalWrites:1,promotedWrites:1,automaticReplays:0,
    writablePrimariesAfterRejoin:1,
    isolatedFixturesDisposed:true
  });
}

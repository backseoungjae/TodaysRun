import type { createRunRepository } from '@/database/repositories/runRepository';
import type { RunRecord } from '@/database/databaseTypes';
import type { EnvironmentSnapshot, TrackingSession } from './runEnvironment';
export type RecoveryInspection =
  | { kind: 'none' }
  | { kind: 'owned'; record: RunRecord }
  | { kind: 'required'; records: RunRecord[]; ambiguous: boolean };
type Dependencies = {
  runs: ReturnType<typeof createRunRepository>;
  snapshot(): EnvironmentSnapshot;
  getSession(): TrackingSession | null;
  registered(): Promise<boolean>;
  stop(): Promise<void>;
  clear(): void;
};
export function createRunRecovery(deps: Dependencies) {
  let busy = false;
  return {
    async inspect(): Promise<RecoveryInspection> {
      const sample = deps.snapshot();
      const records = await deps.runs.findUnfinished();
      let lease: TrackingSession | null = null,
        ambiguous = false;
      try {
        lease = deps.getSession();
      } catch {
        ambiguous = true;
        deps.clear();
      }
      const registered = await deps.registered();
      if (!records.length) {
        if (lease || registered) {
          await deps.stop();
          deps.clear();
        }
        return { kind: 'none' };
      }
      const owned = records.find((record) => record.id === lease?.runId);
      if (
        records.length === 1 &&
        owned &&
        lease?.phase === 'active' &&
        lease.ownerToken === sample.processToken &&
        lease.baseElapsedMs <= sample.elapsedRealtimeMs
      )
        return { kind: 'owned', record: owned };
      // 새 프로세스·불명확한 소유권에서는 기록을 변경하지 않고 남은 수집부터 정리한다.
      await deps.stop();
      return {
        kind: 'required',
        records,
        ambiguous:
          ambiguous || !lease || lease.ownerToken === sample.processToken || records.length > 1,
      };
    },
    async save(id: string): Promise<RunRecord | null> {
      if (busy) return null;
      busy = true;
      try {
        await deps.stop();
        deps.clear();
        const row = await deps.runs.findById(id);
        if (!row) throw new Error('복구할 기록이 없어요. 상태를 다시 확인해 주세요.');
        if (row.status === 'completed' && row.completionReason !== 'recovered')
          throw new Error('이미 정상 완료된 기록이에요.');
        return await deps.runs.recover(id, row.stateRevision);
      } finally {
        busy = false;
      }
    },
    async remove(id: string): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await deps.stop();
        deps.clear();
        const row = await deps.runs.findById(id);
        if (!row) return true;
        if (row.status === 'completed')
          throw new Error('이미 완료된 기록은 Activity에서 삭제해 주세요.');
        await deps.runs.deleteById(id, false, row.stateRevision);
        return true;
      } finally {
        busy = false;
      }
    },
  };
}

import type { createRunRepository } from '@/database/repositories/runRepository';
import type { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { restoreRunSession } from '@/database/runSessionSnapshot';
import { acceptGpsFix } from '../domain/gpsTracking';
import type { GpsFix, GpsPolicy } from '../domain/runTypes';
import { sessionNow, type EnvironmentSnapshot, type TrackingSession } from './runEnvironment';

export class GpsClockError extends Error {}
// 단조 시계와 벽시계의 샘플 오차를 허용하는 초기 기술 기준이다.
export const PROPOSED_CLOCK_SKEW_MS = 1_000;
type Dependencies = {
  runs: ReturnType<typeof createRunRepository>;
  locations: ReturnType<typeof createRunLocationRepository>;
  getSession(): TrackingSession | null;
  snapshot(): EnvironmentSnapshot;
};
export function createBackgroundGps(deps: Dependencies, policy: GpsPolicy) {
  const current = (id: string) => {
    const session = deps.getSession(),
      sample = deps.snapshot();
    if (
      !session ||
      session.runId !== id ||
      !session.collecting ||
      session.ownerToken !== sample.processToken
    )
      return null;
    return { session, sample, now: sessionNow(session, sample) };
  };
  return {
    async processBatch(input: readonly GpsFix[]) {
      const lease = deps.getSession();
      if (!lease || !current(lease.runId)) return { accepted: 0, rejected: input.length };
      const collection = () => {
        const owned = current(lease.runId);
        return owned?.session.collectionRevision === lease.collectionRevision ? owned : null;
      };
      const fixes = [...input]
        .filter((fix) => Number.isSafeInteger(fix.timestampMs))
        .sort((a, b) => a.timestampMs - b.timestampMs);
      const sample = deps.snapshot();
      if (
        lease.wallOffsetMs !== undefined &&
        Math.abs(sample.wallTimeMs - sessionNow(lease, sample) - lease.wallOffsetMs) >
          PROPOSED_CLOCK_SKEW_MS
      )
        throw new GpsClockError(
          '기기 시각이 변경되어 GPS 시각을 확인할 수 없어요. 일시정지 후 재개해 주세요.',
        );
      const latest = fixes.at(-1);
      // 네이티브 배치의 최신 샘플이 신선할 때만 배치 내부의 이전 측정 시각을 인정한다.
      if (
        !latest ||
        latest.timestampMs > sample.wallTimeMs ||
        sample.wallTimeMs - latest.timestampMs > policy.maxAgeMs
      ) {
        await deps.runs.checkpointCurrent(lease.runId, () => collection()?.now ?? null);
        return { accepted: 0, rejected: input.length };
      }
      let accepted = 0;
      for (const fix of fixes) {
        const result = await deps.locations.appendValidated(lease.runId, (run, last) => {
          const owned = collection();
          if (!owned || run.status !== 'running') return null;
          const ageMs = owned.sample.wallTimeMs - fix.timestampMs;
          if (ageMs < 0) return null;
          const offset = owned.session.wallOffsetMs ?? owned.sample.wallTimeMs - owned.now;
          // 등록 시 고정한 보정값을 써 같은 원본 이벤트가 다른 런타임에서도 같은 ID를 갖게 한다.
          const normalized = { ...fix, timestampMs: fix.timestampMs - offset };
          // 실제 배송 지연만큼 확장한다. 준비 단계의 캐시 신선도 정책은 변경하지 않는다.
          return acceptGpsFix(restoreRunSession(run, last), normalized, owned.now, {
            ...policy,
            maxAgeMs: Math.max(policy.maxAgeMs, ageMs),
          });
        });
        if (result.inserted) accepted++;
      }
      await deps.runs.checkpointCurrent(lease.runId, () => collection()?.now ?? null);
      return { accepted, rejected: input.length - accepted };
    },
  };
}

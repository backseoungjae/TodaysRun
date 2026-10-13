import { isValidGpsPolicy } from '../domain/gpsPolicy';
import { isValidCoordinate, isValidTimestampMs } from '../domain/runMetrics';
import type { GpsFix, GpsPolicy } from '../domain/runTypes';

// 아직 RUNNING 세션이 없으므로 거리 필터를 호출하지 않고 동일한 입력 검증·정책을 사용한다.
export function isReadyLocation(fix: GpsFix, nowMs: number, policy: GpsPolicy): boolean {
  return (
    isValidGpsPolicy(policy) &&
    isValidCoordinate(fix) &&
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters >= 0 &&
    fix.accuracyMeters <= policy.maxAccuracyMeters &&
    isValidTimestampMs(nowMs) &&
    isValidTimestampMs(fix.timestampMs) &&
    fix.timestampMs <= nowMs &&
    nowMs - fix.timestampMs <= policy.maxAgeMs
  );
}

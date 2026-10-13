import type { GpsPolicy } from './runTypes';

// 실기기에서 검증하고 조정할 초기 제안값이다.
// 정확도 30m: 초기 야외 수신을 허용하되 큰 오차를 제외한다.
// 속도 12m/s(43.2km/h): 자유 러닝에 여유를 두면서 순간 이동을 걸러낸다.
// 나이 10초: 지연 콜백을 일부 허용하면서 오래된 캐시 위치를 제외한다.
// 손실 30초: 장시간 끊긴 경로를 임의의 직선으로 추정하지 않는다.
// 자동 기본값이 아니며 호출자가 정책을 명시해야 한다.
export const PROPOSED_GPS_POLICY: GpsPolicy = Object.freeze({
  maxAccuracyMeters: 30,
  maxSpeedMetersPerSecond: 12,
  maxAgeMs: 10_000,
  signalLossMs: 30_000,
});

export function isValidGpsPolicy(policy: GpsPolicy): boolean {
  return (
    Number.isFinite(policy.maxAccuracyMeters) &&
    policy.maxAccuracyMeters > 0 &&
    Number.isFinite(policy.maxSpeedMetersPerSecond) &&
    policy.maxSpeedMetersPerSecond > 0 &&
    Number.isSafeInteger(policy.maxAgeMs) &&
    policy.maxAgeMs >= 0 &&
    Number.isSafeInteger(policy.signalLossMs) &&
    policy.signalLossMs > 0
  );
}

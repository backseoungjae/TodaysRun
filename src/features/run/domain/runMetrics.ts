import type { Coordinate } from './runTypes';

// 지구를 평균 반지름 6,371km의 구로 근사한다. 타원체 측지 계산은 범위 밖이다.
const EARTH_RADIUS_METERS = 6_371_000;
const RADIANS_PER_DEGREE = Math.PI / 180;

export function isValidCoordinate(value: unknown): value is Coordinate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'latitude' in value &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    'longitude' in value &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180
  );
}

export function isValidTimestampMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function calculateDistanceMeters(from: unknown, to: unknown): number | null {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) return null;
  const latitudeDelta = (to.latitude - from.latitude) * RADIANS_PER_DEGREE;
  // 날짜 변경선과 -180/+180의 동일 지점을 처리한다.
  const longitudeDelta = (((to.longitude - from.longitude + 540) % 360) - 180) * RADIANS_PER_DEGREE;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(from.latitude * RADIANS_PER_DEGREE) *
      Math.cos(to.latitude * RADIANS_PER_DEGREE) *
      Math.sin(longitudeDelta / 2) ** 2;
  // 대척점 부근의 부동소수점 오차로 sqrt가 NaN이 되는 것을 방지한다.
  const clamped = Math.min(1, Math.max(0, a));
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

// 표시 문자열 변환은 UI 계층에서 수행하며 측정 불가는 null로 반환한다.
export function calculateAveragePaceSecondsPerKm(
  elapsedMs: number,
  distanceMeters: number,
): number | null {
  if (
    !isValidTimestampMs(elapsedMs) ||
    elapsedMs === 0 ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0
  )
    return null;
  const pace = elapsedMs / distanceMeters;
  return Number.isFinite(pace) ? pace : null;
}

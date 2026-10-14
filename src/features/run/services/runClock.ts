// 러닝 중 OS 시계 변경에 영향을 받지 않는 epoch 기반 시각을 만든다.
export function createRunClock(wall = Date.now, monotonic = () => performance.now()) {
  const baseWall = wall();
  const baseMonotonic = monotonic();
  const now = () => baseWall + Math.floor(Math.max(0, monotonic() - baseMonotonic));
  return { now, normalizeTimestamp: (timestampMs: number) => timestampMs + now() - wall() };
}

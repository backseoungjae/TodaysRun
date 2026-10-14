import { createRunClock } from '../runClock';
it('OS 시계 변경에도 러닝 시각은 단조 증가하고 새 GPS 시각을 같은 기준으로 변환한다', () => {
  let wall = 100_000;
  let monotonic = 0;
  const clock = createRunClock(
    () => wall,
    () => monotonic,
  );
  monotonic = 5_000;
  wall = 3_700_000;
  expect(clock.now()).toBe(105_000);
  expect(clock.normalizeTimestamp(wall - 1_000)).toBe(104_000);
  wall = 10_000;
  monotonic = 6_000;
  expect(clock.now()).toBe(106_000);
});

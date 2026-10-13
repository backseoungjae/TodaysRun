import { calculateAveragePaceSecondsPerKm, calculateDistanceMeters } from '../runMetrics';

describe('Haversine 거리', () => {
  it('같은 좌표의 거리는 정확히 0m다', () => {
    expect(
      calculateDistanceMeters({ latitude: 12, longitude: 34 }, { latitude: 12, longitude: 34 }),
    ).toBe(0);
  });

  it('적도에서 경도 1도 차이는 약 111,194.9m다', () => {
    const distance = calculateDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(distance).not.toBeNull();
    expect(distance).toBeGreaterThan(111_194);
    expect(distance).toBeLessThan(111_196);
  });

  it('날짜 변경선을 짧은 경로로 건넌다', () => {
    expect(
      calculateDistanceMeters({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 }),
    ).toBeCloseTo(222_389.85, 1);
    expect(
      calculateDistanceMeters({ latitude: 0, longitude: 180 }, { latitude: 0, longitude: -180 }),
    ).toBe(0);
  });

  it('대척점에서도 유한한 거리를 반환하며 양방향 거리가 같다', () => {
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 0, longitude: 180 };
    expect(calculateDistanceMeters(a, b)).toBeCloseTo(20_015_086.8, 0);
    expect(calculateDistanceMeters(a, b)).toBe(calculateDistanceMeters(b, a));
  });

  it.each([
    null,
    undefined,
    {},
    { latitude: '0', longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
  ])('잘못된 좌표 %p를 양쪽 입력에서 거부한다', (invalid) => {
    expect(calculateDistanceMeters(invalid, { latitude: 0, longitude: 0 })).toBeNull();
    expect(calculateDistanceMeters({ latitude: 0, longitude: 0 }, invalid)).toBeNull();
  });

  it('위도·경도의 경계값은 허용한다', () => {
    expect(
      calculateDistanceMeters({ latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180 }),
    ).toBeCloseTo(20_015_086.8, 0);
  });
});

describe('평균 페이스', () => {
  it('30분에 5km는 360seconds/km이며 표시용 반올림을 하지 않는다', () => {
    expect(calculateAveragePaceSecondsPerKm(1_800_000, 5000)).toBe(360);
    expect(calculateAveragePaceSecondsPerKm(61_500, 1000)).toBe(61.5);
  });

  it.each([
    [1000, 0],
    [0, 1000],
    [-1, 1000],
    [NaN, 1000],
    [Infinity, 1000],
    [1000, -1],
    [1000, NaN],
    [1000, Infinity],
    [0.5, 1000],
    [Number.MAX_SAFE_INTEGER + 1, 1000],
    [1000, Number.MIN_VALUE],
  ])('시간 %pms / 거리 %pm는 측정 불가다', (elapsedMs, distanceMeters) => {
    expect(calculateAveragePaceSecondsPerKm(elapsedMs, distanceMeters)).toBeNull();
  });
});

import { PROPOSED_GPS_POLICY } from '../gpsPolicy';
import { acceptGpsFix } from '../gpsTracking';
import { getElapsedMs } from '../runSession';
import type { GpsFix, GpsPolicy, RunSession } from '../runTypes';
import { gpsFix, runningSession, transition } from './runFixtures';

const policy = PROPOSED_GPS_POLICY;
function accept(
  session: RunSession,
  fix: GpsFix,
  receivedAtMs = fix.timestampMs,
  customPolicy: GpsPolicy = policy,
) {
  const result = acceptGpsFix(session, fix, receivedAtMs, customPolicy);
  if (!result.accepted) throw new Error(result.reason);
  return result;
}

describe('GPS 입력 검증', () => {
  it.each([
    null,
    {},
    { ...gpsFix(2000), latitude: 91 },
    { ...gpsFix(2000), longitude: -181 },
    { ...gpsFix(2000), latitude: NaN },
    { ...gpsFix(2000), longitude: Infinity },
  ])('잘못된 좌표 %p를 제외한다', (input) => {
    const session = runningSession();
    expect(acceptGpsFix(session, input, 2000, policy)).toEqual({
      accepted: false,
      session,
      reason: 'invalid-coordinate',
    });
  });

  it.each([-1, NaN, Infinity, undefined, '5'])('정확도 %p는 잘못된 입력이다', (accuracyMeters) => {
    expect(
      acceptGpsFix(runningSession(), { ...gpsFix(2000), accuracyMeters }, 2000, policy),
    ).toMatchObject({ accepted: false, reason: 'invalid-accuracy' });
  });

  it('정확도 한계는 포함하며 한계를 넘으면 제외한다', () => {
    expect(acceptGpsFix(runningSession(), gpsFix(2000, 0, 30), 2000, policy).accepted).toBe(true);
    expect(acceptGpsFix(runningSession(), gpsFix(2000, 0, 31), 2000, policy)).toMatchObject({
      accepted: false,
      reason: 'poor-accuracy',
    });
  });

  it.each([-1, NaN, Infinity, 0.5, undefined, '2000'])(
    '좌표 시각 %p는 잘못된 입력이다',
    (timestampMs) => {
      expect(
        acceptGpsFix(runningSession(), { ...gpsFix(2000), timestampMs }, 2000, policy),
      ).toMatchObject({ accepted: false, reason: 'invalid-timestamp' });
    },
  );

  it('오래된 위치와 미래 위치를 제외하고 나이 한계는 허용한다', () => {
    expect(acceptGpsFix(runningSession(), gpsFix(2000), 12_000, policy).accepted).toBe(true);
    expect(acceptGpsFix(runningSession(), gpsFix(2000), 12_001, policy)).toMatchObject({
      accepted: false,
      reason: 'stale-timestamp',
    });
    expect(acceptGpsFix(runningSession(), gpsFix(2001), 2000, policy)).toMatchObject({
      accepted: false,
      reason: 'future-timestamp',
    });
  });

  it.each([2000, 1999])('중복·역순 시각 %p의 위치는 제외한다', (timestampMs) => {
    const session = accept(runningSession(), gpsFix(2000)).session;
    const result = acceptGpsFix(session, gpsFix(timestampMs), 3000, policy);
    expect(result).toEqual({ accepted: false, session, reason: 'non-increasing-timestamp' });
    expect(result.session).toBe(session);
  });

  it('시작 전 좌표와 잘못된 수신 시각도 제외한다', () => {
    expect(acceptGpsFix(runningSession(), gpsFix(999), 2000, policy)).toMatchObject({
      accepted: false,
      reason: 'before-active-interval',
    });
    for (const receivedAtMs of [NaN, Infinity, -1, 999]) {
      expect(acceptGpsFix(runningSession(), gpsFix(2000), receivedAtMs, policy)).toMatchObject({
        accepted: false,
        reason: 'invalid-received-time',
      });
    }
  });

  it('순간 이동은 제외하고 다음 정상 위치의 기준점을 오염시키지 않는다', () => {
    const session = accept(runningSession(), gpsFix(2000)).session;
    const jump = acceptGpsFix(session, gpsFix(3000, 1), 3000, policy);
    expect(jump).toEqual({ accepted: false, session, reason: 'excessive-speed' });
    const valid = accept(jump.session, gpsFix(3000, 0.00005));
    expect(valid.point.distanceIncrementMeters).toBeCloseTo(5.5597, 3);
    expect(valid.session.gps.distanceMeters).toBeCloseTo(5.5597, 3);
  });

  it('조정한 정책이 정확도·속도·데이터 나이 판정에 반영된다', () => {
    const session = accept(runningSession(), gpsFix(2000)).session;
    expect(
      acceptGpsFix(session, gpsFix(3000, 0.00005), 3000, { ...policy, maxSpeedMetersPerSecond: 5 }),
    ).toMatchObject({ accepted: false, reason: 'excessive-speed' });
    expect(
      acceptGpsFix(session, gpsFix(3000, 0.00005), 3000, { ...policy, maxSpeedMetersPerSecond: 6 })
        .accepted,
    ).toBe(true);
    expect(
      acceptGpsFix(session, gpsFix(3000, 0, 31), 3000, { ...policy, maxAccuracyMeters: 40 })
        .accepted,
    ).toBe(true);
    expect(acceptGpsFix(session, gpsFix(3000), 3001, { ...policy, maxAgeMs: 0 })).toMatchObject({
      accepted: false,
      reason: 'stale-timestamp',
    });
  });

  it.each([
    { ...policy, maxAccuracyMeters: 0 },
    { ...policy, maxSpeedMetersPerSecond: Infinity },
    { ...policy, maxAgeMs: -1 },
    { ...policy, signalLossMs: 0 },
  ])('잘못된 정책 %p는 좌표를 받기 전에 거부한다', (invalidPolicy) => {
    expect(acceptGpsFix(runningSession(), gpsFix(2000), 2000, invalidPolicy)).toMatchObject({
      accepted: false,
      reason: 'invalid-policy',
    });
  });
});

describe('경로 구간과 운동 생명주기', () => {
  it('첫 좌표는 구간 0의 기준점이고 정지 좌표는 거리를 늘리지 않는다', () => {
    const first = accept(runningSession(), gpsFix(2000));
    expect(first.point.segmentId).toBe(0);
    expect(first.startsNewSegment).toBe(true);
    expect(first.point.distanceIncrementMeters).toBe(0);
    const next = accept(first.session, gpsFix(3000));
    expect(next.startsNewSegment).toBe(false);
    expect(next.session.gps.distanceMeters).toBe(0);
  });

  it('Pause/Resume 뒤 첫 좌표를 연결하지 않으며 이전 운동 시간·거리를 유지한다', () => {
    let session = accept(runningSession(), gpsFix(2000)).session;
    session = accept(session, gpsFix(3000, 0.00005)).session;
    session = transition(session, 'PAUSE', 4000);
    expect(acceptGpsFix(session, gpsFix(5000, 1), 5000, policy)).toEqual({
      accepted: false,
      session,
      reason: 'not-running',
    });
    expect(getElapsedMs(session, 9000)).toBe(3000);
    session = transition(session, 'RESUME', 10_000);
    expect(acceptGpsFix(session, gpsFix(9000, 1), 11_000, policy)).toMatchObject({
      accepted: false,
      reason: 'before-active-interval',
    });
    const resumed = accept(session, gpsFix(11_000, 1));
    expect(resumed.point.segmentId).toBe(1);
    expect(resumed.point.distanceIncrementMeters).toBe(0);
    const moved = accept(resumed.session, gpsFix(12_000, 1.00005));
    expect(moved.session.gps.distanceMeters).toBeCloseTo(11.1195, 3);
    expect(getElapsedMs(moved.session, 12_000)).toBe(5000);
  });

  it('손실 한계 직전은 연결하되 한계부터 새 구간으로 받는다', () => {
    const first = accept(runningSession(), gpsFix(2000)).session;
    expect(accept(first, gpsFix(31_999)).startsNewSegment).toBe(false);
    const recovered = accept(first, gpsFix(32_000, 1));
    expect(recovered.startsNewSegment).toBe(true);
    expect(recovered.point.segmentId).toBe(1);
    expect(recovered.point.distanceIncrementMeters).toBe(0);
    expect(getElapsedMs(recovered.session, 32_000)).toBe(31_000);
    expect(
      accept(first, gpsFix(7000, 1), 7000, { ...policy, signalLossMs: 5000 }).startsNewSegment,
    ).toBe(true);
  });

  it('여러 차례 재개해도 다음 유효 좌표에서만 구간 번호가 증가한다', () => {
    let session = accept(runningSession(), gpsFix(2000)).session;
    session = transition(session, 'PAUSE', 3000);
    session = transition(session, 'RESUME', 4000);
    session = transition(session, 'PAUSE', 5000);
    session = transition(session, 'RESUME', 6000);
    const next = accept(session, gpsFix(7000, 1));
    expect(next.point.segmentId).toBe(1);
    const second = accept(
      transition(transition(next.session, 'PAUSE', 8000), 'RESUME', 9000),
      gpsFix(10_000, 2),
    );
    expect(second.point.segmentId).toBe(2);
    expect(second.session.gps.distanceMeters).toBe(0);
  });

  it('부정확한 수신은 손실 기준점을 갱신하지 않고 장시간 뒤에 구간을 분리한다', () => {
    const first = accept(runningSession(), gpsFix(2000)).session;
    const bad = acceptGpsFix(first, gpsFix(20_000, 1, 100), 20_000, policy);
    expect(bad.accepted).toBe(false);
    const recovered = accept(bad.session, gpsFix(32_000, 1));
    expect(recovered.point.segmentId).toBe(1);
    expect(recovered.session.gps.distanceMeters).toBe(0);
  });

  it('GPS 갱신은 전이 번호를 바꾸지 않으며 완료 후 늦은 좌표를 거부한다', () => {
    const session = runningSession();
    const updated = accept(session, gpsFix(2000), 2500).session;
    expect(updated.revision).toBe(session.revision);
    expect(getElapsedMs(updated, 2499)).toBeNull();
    const completed = transition(updated, 'FINISH', 3000);
    expect(acceptGpsFix(completed, gpsFix(4000), 4000, policy)).toEqual({
      accepted: false,
      session: completed,
      reason: 'not-running',
    });
  });

  it('받은 좌표를 복사해 보관하여 호출자의 입력 변경이 기록에 영향을 주지 않는다', () => {
    const input = { ...gpsFix(2000) };
    const session = Object.freeze(runningSession());
    Object.freeze(session.gps);
    const result = accept(session, input);
    input.longitude = 1;
    expect(result.session.gps.anchor?.longitude).toBe(0);
    expect(session.gps.anchor).toBeNull();
    expect(session.gps.distanceMeters).toBe(0);
  });
});

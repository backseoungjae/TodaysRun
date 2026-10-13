import { createRunSession, getElapsedMs, transitionRunSession } from '../runSession';
import type { RunEvent, RunSession, RunStatus } from '../runTypes';
import { runningSession, transition } from './runFixtures';

describe('운동 시간', () => {
  it('전달된 시각으로 계산하며 조회 횟수는 누적 시간에 영향을 주지 않는다', () => {
    const session = runningSession();
    expect(getElapsedMs(session, 6000)).toBe(5000);
    expect(getElapsedMs(session, 6000)).toBe(5000);
    expect(getElapsedMs(session, 11_000)).toBe(10_000);
    expect(session.elapsedMs).toBe(0);
  });

  it('Pause 중에는 증가하지 않고 Resume 후 운동 시간만 더한다', () => {
    const paused = transition(runningSession(), 'PAUSE', 6000);
    expect(getElapsedMs(paused, 20_000)).toBe(5000);
    const resumed = transition(paused, 'RESUME', 25_000);
    expect(getElapsedMs(resumed, 28_000)).toBe(8000);
  });

  it('여러 차례 Pause/Resume과 종료 후에도 중복 계산하지 않는다', () => {
    let session = runningSession();
    session = transition(session, 'PAUSE', 6000);
    session = transition(session, 'RESUME', 10_000);
    session = transition(session, 'PAUSE', 14_000);
    session = transition(session, 'RESUME', 16_000);
    session = transition(session, 'FINISH', 20_000);
    expect(getElapsedMs(session, 20_000)).toBe(13_000);
    expect(getElapsedMs(session, 90_000)).toBe(13_000);
  });

  it('PAUSED에서 종료해도 정지 시간은 포함하지 않는다', () => {
    const session = transition(transition(runningSession(), 'PAUSE', 6000), 'FINISH', 20_000);
    expect(getElapsedMs(session, 30_000)).toBe(5000);
  });

  it('같은 시각의 Pause/Resume도 합법적이며 시간은 중복되지 않는다', () => {
    const session = transition(transition(runningSession(), 'PAUSE', 6000), 'RESUME', 6000);
    expect(getElapsedMs(session, 7000)).toBe(6000);
  });

  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, 999])(
    '잘못되거나 역순인 시각 %p에서는 상태와 시간을 변경하지 않는다',
    (atMs) => {
      const session = runningSession();
      expect(getElapsedMs(session, atMs)).toBeNull();
      expect(
        transitionRunSession(session, { type: 'PAUSE', atMs, expectedRevision: session.revision }),
      ).toEqual({ accepted: false, session, reason: 'invalid-time' });
    },
  );
});

describe('상태 전이', () => {
  const events: RunEvent['type'][] = [
    'BEGIN_COUNTDOWN',
    'CANCEL_COUNTDOWN',
    'START',
    'PAUSE',
    'RESUME',
    'FINISH',
  ];
  const ready = createRunSession();
  const countdown = transition(ready, 'BEGIN_COUNTDOWN', 0);
  const running = transition(countdown, 'START', 1000);
  const paused = transition(running, 'PAUSE', 2000);
  const completed = transition(paused, 'FINISH', 3000);
  const sessions: RunSession[] = [ready, countdown, running, paused, completed];
  const allowed: Record<RunStatus, Partial<Record<RunEvent['type'], RunStatus>>> = {
    READY: { BEGIN_COUNTDOWN: 'COUNTDOWN' },
    COUNTDOWN: { CANCEL_COUNTDOWN: 'READY', START: 'RUNNING' },
    RUNNING: { PAUSE: 'PAUSED', FINISH: 'COMPLETED' },
    PAUSED: { RESUME: 'RUNNING', FINISH: 'COMPLETED' },
    COMPLETED: {},
  };
  it.each(
    sessions.flatMap((session) => events.map((event) => [session.status, event, session] as const)),
  )('%s에서 %s의 허용 여부를 검증한다', (status, type, session) => {
    const result = transitionRunSession(session, {
      type,
      atMs: 4000,
      expectedRevision: session.revision,
    });
    const expectedStatus = allowed[status][type];
    if (expectedStatus) {
      expect(result.accepted).toBe(true);
      expect(result.session.status).toBe(expectedStatus);
      expect(result.session.revision).toBe(session.revision + 1);
    } else {
      expect(result).toEqual({ accepted: false, session, reason: 'invalid-transition' });
      expect(result.session).toBe(session);
    }
  });

  it('카운트다운 취소는 시작 시각·거리·시간 없는 READY로 복귀한다', () => {
    const cancelled = transition(countdown, 'CANCEL_COUNTDOWN', 100);
    expect(cancelled.status).toBe('READY');
    expect(cancelled.startedAtMs).toBeNull();
    expect(cancelled.gps.segmentId).toBeNull();
    expect(cancelled.gps.distanceMeters).toBe(0);
    expect(getElapsedMs(cancelled, 500)).toBe(0);
  });

  it('빠른 중복 입력과 재개 이후 도착한 과거 Pause를 차단한다', () => {
    const event: RunEvent = { type: 'PAUSE', atMs: 2000, expectedRevision: running.revision };
    const first = transitionRunSession(running, event);
    expect(first.accepted).toBe(true);
    expect(transitionRunSession(first.session, event).accepted).toBe(false);
    const resumed = transition(first.session, 'RESUME', 3000);
    expect(transitionRunSession(resumed, { ...event, atMs: 4000 })).toEqual({
      accepted: false,
      session: resumed,
      reason: 'stale-revision',
    });
  });

  it('취소 후 지연된 START와 완료 후 중복 종료를 차단한다', () => {
    const cancelled = transition(countdown, 'CANCEL_COUNTDOWN', 100);
    expect(
      transitionRunSession(cancelled, {
        type: 'START',
        atMs: 200,
        expectedRevision: countdown.revision,
      }).accepted,
    ).toBe(false);
    expect(
      transitionRunSession(completed, {
        type: 'FINISH',
        atMs: 4000,
        expectedRevision: paused.revision,
      }).accepted,
    ).toBe(false);
    expect(completed.elapsedMs).toBe(1000);
  });

  it('원본 세션을 변경하지 않는다', () => {
    const session = Object.freeze(runningSession());
    Object.freeze(session.gps);
    const next = transition(session, 'PAUSE', 2000);
    expect(session.status).toBe('RUNNING');
    expect(session.elapsedMs).toBe(0);
    expect(next.status).toBe('PAUSED');
  });
});

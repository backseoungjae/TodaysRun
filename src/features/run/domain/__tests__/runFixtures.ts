import { createRunSession, transitionRunSession } from '../runSession';
import type { GpsFix, RunEvent, RunSession } from '../runTypes';

export function transition(session: RunSession, type: RunEvent['type'], atMs: number): RunSession {
  const result = transitionRunSession(session, { type, atMs, expectedRevision: session.revision });
  if (!result.accepted) throw new Error(result.reason);
  return result.session;
}

export function runningSession(): RunSession {
  return transition(transition(createRunSession(), 'BEGIN_COUNTDOWN', 0), 'START', 1000);
}

// 실제 생활 좌표 대신 적도 부근의 가상 데이터를 사용한다.
export function gpsFix(timestampMs: number, longitude = 0, accuracyMeters = 5): GpsFix {
  return { latitude: 0, longitude, accuracyMeters, timestampMs };
}

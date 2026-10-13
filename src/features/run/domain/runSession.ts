import { isValidTimestampMs } from './runMetrics';
import type { RunEvent, RunSession, RunStatus, TransitionResult } from './runTypes';

const transitionTargets: Record<RunEvent['type'], Partial<Record<RunStatus, RunStatus>>> = {
  BEGIN_COUNTDOWN: { READY: 'COUNTDOWN' },
  CANCEL_COUNTDOWN: { COUNTDOWN: 'READY' },
  START: { COUNTDOWN: 'RUNNING' },
  PAUSE: { RUNNING: 'PAUSED' },
  RESUME: { PAUSED: 'RUNNING' },
  FINISH: { RUNNING: 'COMPLETED', PAUSED: 'COMPLETED' },
};

export function createRunSession(): RunSession {
  return {
    status: 'READY',
    revision: 0,
    startedAtMs: null,
    activeSinceMs: null,
    lastUpdatedAtMs: null,
    elapsedMs: 0,
    gps: { anchor: null, lastAcceptedTimestampMs: null, segmentId: null, distanceMeters: 0 },
  };
}

export function getElapsedMs(session: RunSession, atMs: number): number | null {
  if (
    !isValidTimestampMs(atMs) ||
    (session.lastUpdatedAtMs !== null && atMs < session.lastUpdatedAtMs)
  )
    return null;
  return session.elapsedMs + (session.status === 'RUNNING' ? atMs - session.activeSinceMs : 0);
}

export function transitionRunSession(session: RunSession, event: RunEvent): TransitionResult {
  if (event.expectedRevision !== session.revision) {
    return { accepted: false, session, reason: 'stale-revision' };
  }
  const elapsedMs = getElapsedMs(session, event.atMs);
  if (elapsedMs === null) return { accepted: false, session, reason: 'invalid-time' };
  const nextStatus = transitionTargets[event.type][session.status];
  if (!nextStatus) return { accepted: false, session, reason: 'invalid-transition' };
  const nextBase = { ...session, revision: session.revision + 1, lastUpdatedAtMs: event.atMs };
  if (nextStatus === 'RUNNING') {
    return {
      accepted: true,
      session: {
        ...nextBase,
        status: nextStatus,
        startedAtMs: event.type === 'START' ? event.atMs : session.startedAtMs,
        activeSinceMs: event.atMs,
      },
    };
  }
  return {
    accepted: true,
    session: {
      ...nextBase,
      status: nextStatus,
      activeSinceMs: null,
      elapsedMs,
      gps:
        nextStatus === 'PAUSED' || nextStatus === 'COMPLETED'
          ? { ...session.gps, anchor: null }
          : session.gps,
    },
  };
}

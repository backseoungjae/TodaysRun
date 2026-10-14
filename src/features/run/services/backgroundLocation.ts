import * as Location from 'expo-location';
import { runEnvironment, sessionNow } from './runEnvironment';
import type { EnvironmentSnapshot, TrackingSession } from './runEnvironment';

export const RUN_LOCATION_TASK = 'todaysrun.location.v1';
let control = Promise.resolve();
function serialize<T>(operation: () => Promise<T>) {
  const result = control.then(operation);
  control = result.then(
    () => {},
    () => {},
  );
  return result;
}
export function createNativeRunClock() {
  let base = runEnvironment.snapshot();
  const now = () => {
    const sample = runEnvironment.snapshot(),
      session = runEnvironment.getSession();
    return session?.ownerToken === sample.processToken
      ? sessionNow(session, sample)
      : base.wallTimeMs + sample.elapsedRealtimeMs - base.elapsedRealtimeMs;
  };
  return {
    now,
    normalizeTimestamp: (stamp: number) => now() + stamp - runEnvironment.snapshot().wallTimeMs,
    get base() {
      return base;
    },
    reset() {
      if (runEnvironment.getSession())
        throw new Error('이전 세션을 정리한 후 시계를 시작해 주세요.');
      base = runEnvironment.snapshot();
    },
  };
}
export const backgroundLocation = {
  registered: () => Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK),
  start(runId: string, base: EnvironmentSnapshot) {
    return serialize(async () => {
      const existing = runEnvironment.getSession();
      if (existing && (existing.ownerToken !== base.processToken || existing.runId !== runId))
        throw new Error('이전 위치 Task를 정리한 후 시작해 주세요.');
      if (
        existing?.collecting &&
        (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
      )
        return;
      const session: TrackingSession = existing ?? {
        runId,
        ownerToken: base.processToken,
        baseEpochMs: base.wallTimeMs,
        baseElapsedMs: base.elapsedRealtimeMs,
        collecting: false,
        failure: null,
        phase: 'starting',
      };
      const sample = runEnvironment.snapshot();
      runEnvironment.setSession({
        ...session,
        collecting: true,
        collectionRevision: (session.collectionRevision ?? 0) + 1,
        failure: null,
        wallOffsetMs: sample.wallTimeMs - sessionNow(session, sample),
      });
      try {
        if (!(await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)))
          await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            timeInterval: 1_000,
            distanceInterval: 0,
            deferredUpdatesInterval: 0,
            pausesUpdatesAutomatically: false,
            foregroundService: {
              notificationTitle: 'TodaysRun 러닝 기록 중',
              notificationBody: '화면을 끄거나 다른 앱을 사용해도 위치와 러닝 경로를 기록합니다.',
              killServiceOnDestroy: true,
            },
          });
      } catch (error) {
        runEnvironment.setSession({ ...session, collecting: false, failure: 'location' });
        throw error;
      }
    });
  },
  stop(clearFailure = true) {
    // 네이티브 중단이 실패하더라도 추가 SQLite 위치 쓰기는 먼저 차단한다.
    const session = runEnvironment.getSession();
    if (session) runEnvironment.setSession({ ...session, collecting: false });
    return serialize(async () => {
      try {
        if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
          await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
        const latest = runEnvironment.getSession();
        if (latest && clearFailure) runEnvironment.setSession({ ...latest, failure: null });
      } catch (error) {
        const latest = runEnvironment.getSession();
        if (latest) runEnvironment.setSession({ ...latest, failure: 'location' });
        throw error;
      }
    });
  },
  committed() {
    const session = runEnvironment.getSession();
    if (session) runEnvironment.setSession({ ...session, phase: 'active' });
  },
  clear() {
    runEnvironment.setSession(null);
  },
};

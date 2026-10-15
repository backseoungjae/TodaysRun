import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';
import { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { settingsService } from '@/features/settings/settingsService';
import { locationAdapter } from './locationAdapter';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';
import { runStore } from '../store/runStore';
import { backgroundLocation, createNativeRunClock } from './backgroundLocation';
import { runEnvironment, sessionNow } from './runEnvironment';
import { restoreRunSession } from '@/database/runSessionSnapshot';
import { createRunClock } from './runClock';
import { createRunService } from './runService';
import type { GpsFix } from '../domain/runTypes';

type RuntimeCache = {
  shared: Promise<ReturnType<typeof createRunService>> | null;
  navigationReady: (() => void) | null;
  sequence: number;
  normalizeTimestamp(value: number): number;
  resetClock?: () => void;
};
// Fast Refresh에서도 같은 세션을 유지한다. 앱 프로세스 재시작 시 이 메모리는 사라진다.
const runtimeGlobal = globalThis as typeof globalThis & { todaysRunRuntime?: RuntimeCache };
const cache = (runtimeGlobal.todaysRunRuntime ??= {
  shared: null,
  navigationReady: null,
  sequence: 0,
  normalizeTimestamp: (value: number) => value,
});
export function acknowledgeRunningScreen() {
  cache.navigationReady?.();
}

export function getRunService() {
  if (!cache.shared)
    cache.shared = getDatabase()
      .then((db) => {
        const nativeClock = Platform.OS === 'android' ? createNativeRunClock() : null;
        const clock = nativeClock ?? createRunClock();
        cache.normalizeTimestamp = clock.normalizeTimestamp;
        cache.resetClock = nativeClock?.reset;
        const service = createRunService(
          {
            runs: createRunRepository(db),
            locations: createRunLocationRepository(db),
            store: runStore,
            now: clock.now,
            makeId: () =>
              `${Date.now().toString(36)}-${++cache.sequence}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
            canStart: async () => {
              const [settings, foreground, backgroundAllowed, enabled] = await Promise.all([
                settingsService.get(),
                locationAdapter.getPermission('foreground'),
                Platform.OS === 'android'
                  ? Promise.resolve(true)
                  : locationAdapter
                      .getPermission('background')
                      .then((permission) => permission.granted),
                locationAdapter.servicesEnabled(),
              ]);
              return (
                AppState.currentState === 'active' &&
                settings.backgroundTrackingEnabled &&
                foreground.granted &&
                backgroundAllowed &&
                enabled
              );
            },
            location: {
              watch: (onFix, onError) =>
                locationAdapter.watch(
                  (fix) =>
                    onFix({ ...fix, timestampMs: clock.normalizeTimestamp(fix.timestampMs) }),
                  onError,
                ),
            },
            background:
              nativeClock !== null
                ? {
                    start: (id) => backgroundLocation.start(id, nativeClock.base),
                    stop: backgroundLocation.stop,
                    clear: backgroundLocation.clear,
                    committed: backgroundLocation.committed,
                    reload: async (id) => {
                      const snapshot = await createRunLocationRepository(db).loadSession(id);
                      let lease = runEnvironment.getSession();
                      if (snapshot.run.status === 'running' && lease?.collecting) {
                        const [fg, enabled, registered] = await Promise.all([
                          locationAdapter.getPermission('foreground'),
                          locationAdapter.servicesEnabled(),
                          backgroundLocation.registered(),
                        ]);
                        if (!fg.granted || !enabled || !registered) {
                          runEnvironment.setSession({ ...lease, failure: 'location' });
                          await backgroundLocation.stop(false);
                          lease = runEnvironment.getSession();
                        }
                      }
                      const failure = lease?.failure;
                      return {
                        session: restoreRunSession(snapshot.run, snapshot.path.at(-1) ?? null),
                        path: snapshot.path,
                        error:
                          failure === 'storage'
                            ? '위치 저장에 실패했어요. 다음 위치에서 재시도해요.'
                            : failure === 'location'
                              ? '위치 수신에 문제가 있어요. 권한과 GPS를 확인한 뒤 일시정지·재개해 주세요.'
                              : null,
                      };
                    },
                    checkpoint: async (id) => {
                      await createRunRepository(db).checkpointCurrent(id, () => {
                        const lease = runEnvironment.getSession(),
                          sample = runEnvironment.snapshot();
                        return lease?.runId === id && lease.ownerToken === sample.processToken
                          ? sessionNow(lease, sample)
                          : null;
                      });
                    },
                  }
                : undefined,
            navigateRunning: () =>
              new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  cache.navigationReady = null;
                  router.replace('/');
                  reject(new Error('러닝 화면을 열지 못했어요. 다시 시도해 주세요.'));
                }, 10_000);
                cache.navigationReady = () => {
                  clearTimeout(timeout);
                  cache.navigationReady = null;
                  resolve();
                };
                try {
                  router.push('/running');
                } catch (error) {
                  clearTimeout(timeout);
                  cache.navigationReady = null;
                  reject(error);
                }
              }),
          },
          PROPOSED_GPS_POLICY,
        );
        AppState.addEventListener('change', (state) => {
          void service.setForeground(state === 'active');
        });
        return service;
      })
      .catch((error: unknown) => {
        cache.shared = null;
        throw error;
      });
  return cache.shared;
}
export async function startPreparedRun(fix: GpsFix, signal: AbortSignal) {
  const service = await getRunService();
  if (!service.hasActiveRun() && Platform.OS === 'android' && !runEnvironment.getSession())
    cache.resetClock?.();
  await service.start({ ...fix, timestampMs: cache.normalizeTimestamp(fix.timestampMs) }, signal);
}

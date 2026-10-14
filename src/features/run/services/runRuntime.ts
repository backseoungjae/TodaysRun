import { AppState } from 'react-native';
import { router } from 'expo-router';
import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';
import { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { settingsService } from '@/features/settings/settingsService';
import { locationAdapter } from './locationAdapter';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';
import { runStore } from '../store/runStore';
import { createRunClock } from './runClock';
import { createRunService } from './runService';
import type { GpsFix } from '../domain/runTypes';

type RuntimeCache = {
  shared: Promise<ReturnType<typeof createRunService>> | null;
  navigationReady: (() => void) | null;
  sequence: number;
  normalizeTimestamp(value: number): number;
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
        const clock = createRunClock();
        cache.normalizeTimestamp = clock.normalizeTimestamp;
        const service = createRunService(
          {
            runs: createRunRepository(db),
            locations: createRunLocationRepository(db),
            store: runStore,
            now: clock.now,
            makeId: () =>
              `${Date.now().toString(36)}-${++cache.sequence}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
            canStart: async () => {
              const [settings, foreground, background, enabled] = await Promise.all([
                settingsService.get(),
                locationAdapter.getPermission('foreground'),
                locationAdapter.getPermission('background'),
                locationAdapter.servicesEnabled(),
              ]);
              return (
                AppState.currentState === 'active' &&
                settings.backgroundTrackingEnabled &&
                foreground.granted &&
                background.granted &&
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
  await service.start({ ...fix, timestampMs: cache.normalizeTimestamp(fix.timestampMs) }, signal);
}

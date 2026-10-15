import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import type { LocationObject } from 'expo-location';
import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';
import { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { createBackgroundGps, GpsClockError } from './backgroundGps';
import { runEnvironment } from './runEnvironment';
import { backgroundLocation, RUN_LOCATION_TASK } from './backgroundLocation';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';

export async function handleBackgroundLocations(
  locations: readonly LocationObject[] | null,
  locationError = false,
) {
  const lease = runEnvironment.getSession();
  if (!lease || !lease.collecting || lease.ownerToken !== runEnvironment.snapshot().processToken) {
    await backgroundLocation.stop(false);
    return;
  }
  const sameCollection = () => {
    const latest = runEnvironment.getSession();
    return latest?.runId === lease.runId &&
      latest.collecting &&
      latest.collectionRevision === lease.collectionRevision
      ? latest
      : null;
  };
  if (locationError) {
    runEnvironment.setSession({ ...lease, failure: 'location' });
    return;
  }
  if (!locations) return;
  try {
    const [foreground, enabled] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.hasServicesEnabledAsync(),
    ]);
    if (!foreground.granted || !enabled) throw new Error('location-unavailable');
  } catch {
    const latest = sameCollection();
    if (latest) {
      runEnvironment.setSession({ ...latest, failure: 'location' });
      await backgroundLocation.stop(false);
    }
    return;
  }
  const fixes = locations.map((value) => ({
    latitude: value?.coords?.latitude ?? NaN,
    longitude: value?.coords?.longitude ?? NaN,
    accuracyMeters: value?.coords?.accuracy ?? NaN,
    timestampMs: value?.timestamp ?? NaN,
  }));
  try {
    const db = await getDatabase();
    if (!sameCollection()) return;
    await createBackgroundGps(
      {
        runs: createRunRepository(db),
        locations: createRunLocationRepository(db),
        getSession: runEnvironment.getSession,
        snapshot: runEnvironment.snapshot,
      },
      PROPOSED_GPS_POLICY,
    ).processBatch(fixes);
    const latest = sameCollection();
    if (latest?.failure === 'storage') runEnvironment.setSession({ ...latest, failure: null });
  } catch (error: unknown) {
    const latest = sameCollection();
    if (latest) {
      runEnvironment.setSession({
        ...latest,
        failure: error instanceof GpsClockError ? 'location' : 'storage',
      });
      if (error instanceof GpsClockError) await backgroundLocation.stop(false);
    }
  }
}
if (!TaskManager.isTaskDefined(RUN_LOCATION_TASK))
  TaskManager.defineTask<{ locations: LocationObject[] }>(
    RUN_LOCATION_TASK,
    async ({ data, error }) => {
      try {
        await handleBackgroundLocations(data?.locations ?? null, Boolean(error));
      } catch {
        // 좌표·SQL 없이 Task 중단/실행 환경 오류만 남긴다. 데이터는 복구 선택 전 보존한다.
        console.error('TodaysRun 위치 Task 중단 또는 실행 정보 확인에 실패했습니다.');
      }
    },
  );

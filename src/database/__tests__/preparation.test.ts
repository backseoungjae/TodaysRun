import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './nodeSqlite';
import { createAppSettingsRepository } from '../repositories/appSettingsRepository';
import { createRunRepository } from '../repositories/runRepository';
import { createRunPreparation } from '@/features/run/services/runPreparation';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import type { GpsFix } from '@/features/run/domain/runTypes';

it.each(['cancel', 'complete'] as const)(
  '카운트다운 %s 후 실제 SQLite에 러닝 기록이 없다',
  async (action) => {
    const directory = mkdtempSync(join(tmpdir(), 'todaysrun-preparation-'));
    const db = await openNodeDatabase(join(directory, 'test.db'));
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    try {
      const settings = createAppSettingsRepository(db);
      await settings.setBackgroundTrackingEnabled(true);
      let receive: (fix: GpsFix) => void = () => {};
      const completed = jest.fn();
      const preparation = createRunPreparation(
        {
          location: {
            getPermission: async () => ({ granted: true, canAskAgain: true }),
            requestPermission: async () => {},
            openSettings: async () => {},
            servicesEnabled: async () => true,
            watch: async (callback) => {
              receive = callback;
              return { remove() {} };
            },
          },
          backgroundEnabled: async () => (await settings.get()).backgroundTrackingEnabled,
          confirm: async () => true,
          now: Date.now,
          onPrepared: completed,
        },
        PROPOSED_GPS_POLICY,
        () => {},
      );
      const pending = preparation.start();
      for (let i = 0; i < 100; i++) await Promise.resolve();
      receive({ latitude: 0, longitude: 0, accuracyMeters: 5, timestampMs: Date.now() });
      for (let i = 0; i < 100; i++) await Promise.resolve();
      expect(preparation.getState()).toEqual({ status: 'countdown', seconds: 3 });
      if (action === 'cancel') preparation.cancel();
      else await jest.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(completed).toHaveBeenCalledTimes(action === 'complete' ? 1 : 0);
      const runs = createRunRepository(db);
      expect(await runs.findUnfinished()).toEqual([]);
      expect(await runs.listCompleted()).toEqual([]);
    } finally {
      jest.useRealTimers();
      await db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

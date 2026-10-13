import type { DatabaseClient } from '../databaseClient';

export function createAppSettingsRepository(db: DatabaseClient) {
  return {
    async get(): Promise<{ backgroundTrackingEnabled: boolean }> {
      return db.read(async (conn) => {
        const row = await conn.getFirstAsync(
          'SELECT background_tracking_enabled FROM app_settings WHERE id=1',
        );
        if (
          typeof row !== 'object' ||
          row === null ||
          !('background_tracking_enabled' in row) ||
          (row.background_tracking_enabled !== 0 && row.background_tracking_enabled !== 1)
        )
          throw new Error('invalid-settings-row');
        return { backgroundTrackingEnabled: row.background_tracking_enabled === 1 };
      });
    },
    async setBackgroundTrackingEnabled(enabled: boolean): Promise<void> {
      if (typeof enabled !== 'boolean') throw new Error('invalid-setting');
      await db.write(async (txn) => {
        const result = await txn.runAsync(
          'UPDATE app_settings SET background_tracking_enabled=? WHERE id=1',
          enabled ? 1 : 0,
        );
        if (result.changes !== 1) throw new Error('settings-not-found');
      });
    },
  };
}

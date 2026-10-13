import { getDatabase } from '@/database/database';
import { createAppSettingsRepository } from '@/database/repositories/appSettingsRepository';

export const settingsService = {
  async get() {
    return createAppSettingsRepository(await getDatabase()).get();
  },
  async setBackgroundTrackingEnabled(enabled: boolean) {
    await createAppSettingsRepository(await getDatabase()).setBackgroundTrackingEnabled(enabled);
  },
};

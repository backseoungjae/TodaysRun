import { getDatabase } from '@/database/database';
import { createRunRepository } from '@/database/repositories/runRepository';
import { runEnvironment } from './runEnvironment';
import { backgroundLocation } from './backgroundLocation';
import { createRunRecovery } from './runRecovery';
let shared: Promise<ReturnType<typeof createRunRecovery>> | null = null;
export function getRecoveryService() {
  if (!shared)
    shared = getDatabase()
      .then((db) =>
        createRunRecovery({
          runs: createRunRepository(db),
          snapshot: runEnvironment.snapshot,
          getSession: runEnvironment.getSession,
          registered: backgroundLocation.registered,
          stop: backgroundLocation.stop,
          clear: backgroundLocation.clear,
        }),
      )
      .catch((error: unknown) => {
        shared = null;
        throw error;
      });
  return shared;
}

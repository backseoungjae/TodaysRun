import type { RunRecord, RunLocationRecord } from '@/database/databaseTypes';
import type { RunSession } from '@/features/run/domain/runTypes';
export function restoreRunSession(run: RunRecord, last: RunLocationRecord | null): RunSession {
  const base = {
    revision: run.stateRevision,
    startedAtMs: run.startedAtMs,
    lastUpdatedAtMs: run.lastSavedAtMs,
    elapsedMs: run.committedDurationMs,
    gps: {
      anchor:
        last && run.activeSinceMs !== null && last.recordedAtMs >= run.activeSinceMs
          ? {
              latitude: last.latitude,
              longitude: last.longitude,
              accuracyMeters: last.accuracyMeters,
              timestampMs: last.recordedAtMs,
            }
          : null,
      lastAcceptedTimestampMs: last?.recordedAtMs ?? null,
      segmentId: run.segmentIndex,
      distanceMeters: run.distanceMeters,
    },
  };
  if (run.status === 'running' && run.activeSinceMs !== null)
    return { ...base, status: 'RUNNING', activeSinceMs: run.activeSinceMs };
  return { ...base, status: run.status === 'paused' ? 'PAUSED' : 'COMPLETED', activeSinceMs: null };
}

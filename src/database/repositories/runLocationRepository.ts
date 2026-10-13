import type { GpsResult } from '@/features/run/domain/runTypes';
import { isValidCoordinate, isValidTimestampMs } from '@/features/run/domain/runMetrics';
import type { DatabaseClient } from '../databaseClient';
import { parseLocation, requireRun } from './recordValidation';

export function createRunLocationRepository(db: DatabaseClient) {
  return {
    async append(
      id: string,
      accepted: Extract<GpsResult, { accepted: true }>,
    ): Promise<{ inserted: boolean }> {
      const { point, session } = accepted;
      if (
        !isValidCoordinate(point) ||
        !isValidTimestampMs(point.timestampMs) ||
        !Number.isFinite(point.accuracyMeters) ||
        point.accuracyMeters < 0 ||
        !Number.isFinite(point.distanceIncrementMeters) ||
        point.distanceIncrementMeters < 0 ||
        !Number.isSafeInteger(point.segmentId) ||
        point.segmentId < 0 ||
        session.status !== 'RUNNING' ||
        session.lastUpdatedAtMs === null ||
        !isValidTimestampMs(session.lastUpdatedAtMs) ||
        session.lastUpdatedAtMs < point.timestampMs ||
        session.gps.anchor?.timestampMs !== point.timestampMs ||
        session.gps.anchor.latitude !== point.latitude ||
        session.gps.anchor.longitude !== point.longitude ||
        session.gps.anchor.accuracyMeters !== point.accuracyMeters ||
        session.gps.lastAcceptedTimestampMs !== point.timestampMs ||
        session.gps.segmentId !== point.segmentId
      )
        throw new Error('invalid-location-snapshot');
      const savedAtMs = session.lastUpdatedAtMs;
      return db.write(async (txn) => {
        const run = await requireRun(txn, id);
        if (run.status !== 'running') throw new Error('run-not-running');
        if (
          run.stateRevision !== session.revision ||
          run.startedAtMs !== session.startedAtMs ||
          run.activeSinceMs !== session.activeSinceMs
        )
          throw new Error('stale-state');
        const duplicate = await txn.getFirstAsync(
          'SELECT * FROM run_locations WHERE run_id=? AND recorded_at_ms=?',
          id,
          point.timestampMs,
        );
        if (duplicate) {
          const old = parseLocation(duplicate);
          if (
            old.latitude !== point.latitude ||
            old.longitude !== point.longitude ||
            old.accuracyMeters !== point.accuracyMeters ||
            old.segmentIndex !== point.segmentId ||
            old.distanceDeltaMeters !== point.distanceIncrementMeters
          )
            throw new Error('conflicting-location-event');
          return { inserted: false };
        }
        const last = await txn.getFirstAsync(
          'SELECT * FROM run_locations WHERE run_id=? ORDER BY recorded_at_ms DESC LIMIT 1',
          id,
        );
        if (last && parseLocation(last).recordedAtMs >= point.timestampMs)
          throw new Error('out-of-order-location');
        if (
          last &&
          parseLocation(last).recordedAtMs < session.activeSinceMs &&
          !accepted.startsNewSegment
        )
          throw new Error('missing-resume-segment');
        const newSegment = accepted.startsNewSegment;
        const expectedSegment =
          run.segmentIndex === null ? 0 : run.segmentIndex + (newSegment ? 1 : 0);
        if (
          point.segmentId !== expectedSegment ||
          (newSegment && point.distanceIncrementMeters !== 0) ||
          (run.segmentIndex === null && !newSegment) ||
          point.timestampMs < session.activeSinceMs ||
          savedAtMs < run.lastSavedAtMs ||
          session.gps.distanceMeters !== run.distanceMeters + point.distanceIncrementMeters
        )
          throw new Error('unsaved-or-stale-location');
        await txn.runAsync(
          `INSERT INTO run_locations(run_id,latitude,longitude,accuracy_meters,recorded_at_ms,segment_index,distance_delta_meters) VALUES(?,?,?,?,?,?,?)`,
          id,
          point.latitude,
          point.longitude,
          point.accuracyMeters,
          point.timestampMs,
          point.segmentId,
          point.distanceIncrementMeters,
        );
        await txn.runAsync(
          'UPDATE runs SET distance_meters=distance_meters+?,segment_index=?,last_saved_at_ms=? WHERE id=?',
          point.distanceIncrementMeters,
          point.segmentId,
          savedAtMs,
          id,
        );
        return { inserted: true };
      });
    },
    async listForRun(id: string) {
      return db.read(async (conn) =>
        (
          await conn.getAllAsync(
            'SELECT * FROM run_locations WHERE run_id=? ORDER BY recorded_at_ms,id',
            id,
          )
        ).map(parseLocation),
      );
    },
  };
}

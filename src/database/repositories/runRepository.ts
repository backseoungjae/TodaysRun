import { getElapsedMs } from '@/features/run/domain/runSession';
import type { RunSession } from '@/features/run/domain/runTypes';
import type { DatabaseClient } from '../databaseClient';
import type { RunRecord } from '../databaseTypes';
import { parseRun, requireRun, validateId, validateTime } from './recordValidation';

export function createRunRepository(db: DatabaseClient) {
  return {
    async create(id: string, session: RunSession): Promise<RunRecord> {
      validateId(id);
      if (
        session.status !== 'RUNNING' ||
        session.startedAtMs === null ||
        session.activeSinceMs !== session.startedAtMs ||
        session.elapsedMs !== 0 ||
        session.gps.distanceMeters !== 0 ||
        session.gps.segmentId !== null
      )
        throw new Error('invalid-start-session');
      validateTime(session.startedAtMs);
      if (
        session.lastUpdatedAtMs !== session.startedAtMs ||
        !Number.isSafeInteger(session.revision) ||
        session.revision < 1
      )
        throw new Error('invalid-start-session');
      return db.write(async (txn) => {
        await txn.runAsync(
          `INSERT INTO runs(id,status,started_at_ms,active_duration_ms,committed_duration_ms,active_since_ms,
          last_checkpoint_at_ms,last_saved_at_ms,state_revision) VALUES(?,'running',?,0,0,?,?,?,?)`,
          id,
          session.startedAtMs,
          session.activeSinceMs,
          session.startedAtMs,
          session.startedAtMs,
          session.revision,
        );
        return requireRun(txn, id);
      });
    },
    async saveCheckpoint(id: string, session: RunSession, atMs: number): Promise<RunRecord> {
      const duration = getElapsedMs(session, atMs);
      if (
        duration === null ||
        session.status === 'READY' ||
        session.status === 'COUNTDOWN' ||
        session.status === 'COMPLETED'
      )
        throw new Error('invalid-checkpoint');
      return db.write(async (txn) => {
        const row = await requireRun(txn, id);
        if (
          row.status !== session.status.toLowerCase() ||
          row.stateRevision !== session.revision ||
          row.startedAtMs !== session.startedAtMs ||
          row.activeSinceMs !== session.activeSinceMs ||
          row.committedDurationMs !== session.elapsedMs
        )
          throw new Error('stale-state');
        if (atMs < row.lastSavedAtMs || duration < row.activeDurationMs)
          throw new Error('stale-checkpoint');
        await txn.runAsync(
          'UPDATE runs SET active_duration_ms=?, last_checkpoint_at_ms=?, last_saved_at_ms=? WHERE id=?',
          duration,
          atMs,
          atMs,
          id,
        );
        return requireRun(txn, id);
      });
    },
    async saveTransition(
      id: string,
      session: RunSession,
      atMs: number,
      expectedRevision: number,
    ): Promise<RunRecord> {
      const duration = getElapsedMs(session, atMs);
      if (
        duration === null ||
        session.startedAtMs === null ||
        session.lastUpdatedAtMs !== atMs ||
        session.revision !== expectedRevision + 1 ||
        session.status === 'READY' ||
        session.status === 'COUNTDOWN'
      )
        throw new Error('invalid-transition-snapshot');
      return db.write(async (txn) => {
        const row = await requireRun(txn, id);
        const allowed =
          (row.status === 'running' &&
            (session.status === 'PAUSED' || session.status === 'COMPLETED')) ||
          (row.status === 'paused' &&
            (session.status === 'RUNNING' || session.status === 'COMPLETED'));
        if (
          !allowed ||
          row.stateRevision !== expectedRevision ||
          row.startedAtMs !== session.startedAtMs
        )
          throw new Error('stale-state');
        if (
          atMs < row.lastSavedAtMs ||
          duration < row.activeDurationMs ||
          session.gps.distanceMeters !== row.distanceMeters ||
          session.gps.segmentId !== row.segmentIndex
        )
          throw new Error('unsaved-or-stale-session');
        const completed = session.status === 'COMPLETED';
        const expectedDuration =
          row.committedDurationMs + (row.activeSinceMs === null ? 0 : atMs - row.activeSinceMs);
        if (
          duration !== expectedDuration ||
          (session.status === 'RUNNING' && session.activeSinceMs !== atMs) ||
          session.elapsedMs !==
            (session.status === 'RUNNING' ? row.committedDurationMs : expectedDuration)
        )
          throw new Error('inconsistent-duration');
        await txn.runAsync(
          `UPDATE runs SET status=?,active_duration_ms=?,committed_duration_ms=?,active_since_ms=?,
          last_checkpoint_at_ms=?,last_saved_at_ms=?,state_revision=?,ended_at_ms=?,completion_reason=? WHERE id=?`,
          session.status.toLowerCase(),
          duration,
          session.elapsedMs,
          session.activeSinceMs,
          atMs,
          atMs,
          session.revision,
          completed ? atMs : null,
          completed ? 'normal' : null,
          id,
        );
        return requireRun(txn, id);
      });
    },
    async recover(id: string, expectedRevision: number): Promise<RunRecord> {
      return db.write(async (txn) => {
        const row = await requireRun(txn, id);
        if (row.status === 'completed' && row.completionReason === 'recovered') return row;
        if (row.status === 'completed' || row.stateRevision !== expectedRevision)
          throw new Error('stale-state');
        // 복구 시 시계를 읽거나 중단 이후의 시간을 추정하지 않는다.
        await txn.runAsync(
          `UPDATE runs SET status='completed',ended_at_ms=last_saved_at_ms,
          committed_duration_ms=active_duration_ms,active_since_ms=NULL,completion_reason='recovered',state_revision=state_revision+1 WHERE id=?`,
          id,
        );
        return requireRun(txn, id);
      });
    },
    async findById(id: string): Promise<RunRecord | null> {
      return db.read(async (conn) => {
        const row = await conn.getFirstAsync('SELECT * FROM runs WHERE id=?', id);
        return row ? parseRun(row) : null;
      });
    },
    async findUnfinished(): Promise<RunRecord[]> {
      return db.read(async (conn) =>
        (
          await conn.getAllAsync(
            "SELECT * FROM runs WHERE status IN ('running','paused') ORDER BY started_at_ms DESC,id",
          )
        ).map(parseRun),
      );
    },
    async listCompleted(): Promise<RunRecord[]> {
      return db.read(async (conn) =>
        (
          await conn.getAllAsync(
            "SELECT * FROM runs WHERE status='completed' ORDER BY started_at_ms DESC,id",
          )
        ).map(parseRun),
      );
    },
    async deleteById(id: string): Promise<void> {
      await db.write(async (txn) => {
        await txn.runAsync('DELETE FROM runs WHERE id=?', id);
      });
    },
    async deleteAll(): Promise<void> {
      await db.write(async (txn) => {
        await txn.runAsync('DELETE FROM runs');
      });
    },
  };
}

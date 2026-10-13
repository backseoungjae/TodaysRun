import { isValidTimestampMs } from '@/features/run/domain/runMetrics';
import type { RunLocationRecord, RunRecord, SqlExecutor } from '../databaseTypes';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid-database-row');
  return value as Record<string, unknown>;
}
function number(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`invalid-column:${key}`);
  return value;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`invalid-column:${key}`);
  return value;
}
function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : number(row, key);
}
export function parseRun(value: unknown): RunRecord {
  const row = record(value);
  const status = text(row, 'status');
  if (status !== 'running' && status !== 'paused' && status !== 'completed')
    throw new Error('invalid-run-status');
  const reason = row.completion_reason;
  if (reason !== null && reason !== 'normal' && reason !== 'recovered')
    throw new Error('invalid-completion-reason');
  return {
    id: text(row, 'id'),
    status,
    startedAtMs: number(row, 'started_at_ms'),
    endedAtMs: optionalNumber(row, 'ended_at_ms'),
    activeDurationMs: number(row, 'active_duration_ms'),
    committedDurationMs: number(row, 'committed_duration_ms'),
    activeSinceMs: optionalNumber(row, 'active_since_ms'),
    distanceMeters: number(row, 'distance_meters'),
    lastCheckpointAtMs: number(row, 'last_checkpoint_at_ms'),
    lastSavedAtMs: number(row, 'last_saved_at_ms'),
    segmentIndex: optionalNumber(row, 'segment_index'),
    stateRevision: number(row, 'state_revision'),
    completionReason: reason,
  };
}
export function parseLocation(value: unknown): RunLocationRecord {
  const row = record(value);
  return {
    id: number(row, 'id'),
    runId: text(row, 'run_id'),
    latitude: number(row, 'latitude'),
    longitude: number(row, 'longitude'),
    accuracyMeters: number(row, 'accuracy_meters'),
    recordedAtMs: number(row, 'recorded_at_ms'),
    segmentIndex: number(row, 'segment_index'),
    distanceDeltaMeters: number(row, 'distance_delta_meters'),
  };
}
export async function requireRun(txn: SqlExecutor, id: string): Promise<RunRecord> {
  const row = await txn.getFirstAsync('SELECT * FROM runs WHERE id = ?', id);
  if (!row) throw new Error('run-not-found');
  return parseRun(row);
}
export function validateId(id: string): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('invalid-run-id');
}
export function validateTime(atMs: number): void {
  if (!isValidTimestampMs(atMs)) throw new Error('invalid-time');
}

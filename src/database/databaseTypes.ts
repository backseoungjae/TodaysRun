export type SqlValue = string | number | null;
export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    ...params: SqlValue[]
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
  getAllAsync(sql: string, ...params: SqlValue[]): Promise<unknown[]>;
  closeAsync(): Promise<void>;
}

export type RunRecord = Readonly<{
  id: string;
  status: 'running' | 'paused' | 'completed';
  startedAtMs: number;
  endedAtMs: number | null;
  activeDurationMs: number;
  committedDurationMs: number;
  activeSinceMs: number | null;
  distanceMeters: number;
  lastCheckpointAtMs: number;
  lastSavedAtMs: number;
  segmentIndex: number | null;
  stateRevision: number;
  completionReason: 'normal' | 'recovered' | null;
}>;
export type RunLocationRecord = Readonly<{
  id: number;
  runId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAtMs: number;
  segmentIndex: number;
  distanceDeltaMeters: number;
}>;

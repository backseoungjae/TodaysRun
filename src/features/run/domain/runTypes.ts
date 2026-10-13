export type Coordinate = Readonly<{ latitude: number; longitude: number }>;

export type GpsFix = Coordinate &
  Readonly<{
    accuracyMeters: number;
    timestampMs: number;
  }>;

export type GpsPolicy = Readonly<{
  maxAccuracyMeters: number;
  maxSpeedMetersPerSecond: number;
  maxAgeMs: number;
  signalLossMs: number;
}>;

export type GpsTrack = Readonly<{
  anchor: GpsFix | null;
  lastAcceptedTimestampMs: number | null;
  segmentId: number | null;
  distanceMeters: number;
}>;

export type RunStatus = 'READY' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

type RunSessionBase = Readonly<{
  // GPS 갱신과 무관하게 상태 전이가 성공할 때만 증가한다.
  revision: number;
  startedAtMs: number | null;
  lastUpdatedAtMs: number | null;
  // 마지막 Pause/Finish까지 확정된 운동 시간이다.
  elapsedMs: number;
  gps: GpsTrack;
}>;

export type RunSession = RunSessionBase &
  (
    | Readonly<{ status: 'RUNNING'; activeSinceMs: number }>
    | Readonly<{ status: Exclude<RunStatus, 'RUNNING'>; activeSinceMs: null }>
  );

export type RunEvent = Readonly<{
  type: 'BEGIN_COUNTDOWN' | 'CANCEL_COUNTDOWN' | 'START' | 'PAUSE' | 'RESUME' | 'FINISH';
  // Unix epoch millisecond. Date.now() 등의 시계 접근은 호출자 책임이다.
  atMs: number;
  expectedRevision: number;
}>;

export type TransitionResult =
  | Readonly<{ accepted: true; session: RunSession }>
  | Readonly<{
      accepted: false;
      session: RunSession;
      reason: 'stale-revision' | 'invalid-time' | 'invalid-transition';
    }>;

export type GpsRejectionReason =
  | 'not-running'
  | 'invalid-policy'
  | 'invalid-received-time'
  | 'invalid-coordinate'
  | 'invalid-accuracy'
  | 'poor-accuracy'
  | 'invalid-timestamp'
  | 'future-timestamp'
  | 'stale-timestamp'
  | 'non-increasing-timestamp'
  | 'before-active-interval'
  | 'excessive-speed'
  | 'invalid-distance';

export type GpsResult =
  | Readonly<{
      accepted: true;
      session: RunSession;
      point: GpsFix & Readonly<{ segmentId: number; distanceIncrementMeters: number }>;
      startsNewSegment: boolean;
    }>
  | Readonly<{ accepted: false; session: RunSession; reason: GpsRejectionReason }>;

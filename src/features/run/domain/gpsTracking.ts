import { isValidGpsPolicy } from './gpsPolicy';
import { calculateDistanceMeters, isValidCoordinate, isValidTimestampMs } from './runMetrics';
import type { GpsFix, GpsPolicy, GpsRejectionReason, GpsResult, RunSession } from './runTypes';

export function acceptGpsFix(
  session: RunSession,
  input: unknown,
  receivedAtMs: number,
  policy: GpsPolicy,
): GpsResult {
  const reject = (reason: GpsRejectionReason): GpsResult => ({ accepted: false, session, reason });
  if (session.status !== 'RUNNING') return reject('not-running');
  if (!isValidGpsPolicy(policy)) return reject('invalid-policy');
  if (
    !isValidTimestampMs(receivedAtMs) ||
    (session.lastUpdatedAtMs !== null && receivedAtMs < session.lastUpdatedAtMs)
  ) {
    return reject('invalid-received-time');
  }
  if (!isValidCoordinate(input)) return reject('invalid-coordinate');
  if (
    !('accuracyMeters' in input) ||
    typeof input.accuracyMeters !== 'number' ||
    !Number.isFinite(input.accuracyMeters) ||
    input.accuracyMeters < 0
  )
    return reject('invalid-accuracy');
  if (input.accuracyMeters > policy.maxAccuracyMeters) return reject('poor-accuracy');
  if (!('timestampMs' in input) || !isValidTimestampMs(input.timestampMs))
    return reject('invalid-timestamp');
  if (input.timestampMs > receivedAtMs) return reject('future-timestamp');
  if (receivedAtMs - input.timestampMs > policy.maxAgeMs) return reject('stale-timestamp');
  if (
    session.gps.lastAcceptedTimestampMs !== null &&
    input.timestampMs <= session.gps.lastAcceptedTimestampMs
  )
    return reject('non-increasing-timestamp');
  if (input.timestampMs < session.activeSinceMs) return reject('before-active-interval');

  const fix: GpsFix = {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    timestampMs: input.timestampMs,
  };
  const anchor = session.gps.anchor;
  const startsNewSegment =
    anchor === null || fix.timestampMs - anchor.timestampMs >= policy.signalLossMs;
  let distanceIncrementMeters = 0;
  if (!startsNewSegment && anchor !== null) {
    const distance = calculateDistanceMeters(anchor, fix);
    if (distance === null) return reject('invalid-distance');
    const speed = distance / ((fix.timestampMs - anchor.timestampMs) / 1000);
    if (speed > policy.maxSpeedMetersPerSecond) return reject('excessive-speed');
    distanceIncrementMeters = distance;
  }
  const segmentId =
    session.gps.segmentId === null ? 0 : session.gps.segmentId + (startsNewSegment ? 1 : 0);
  const distanceMeters = session.gps.distanceMeters + distanceIncrementMeters;
  if (!Number.isFinite(distanceMeters)) return reject('invalid-distance');
  return {
    accepted: true,
    startsNewSegment,
    point: { ...fix, segmentId, distanceIncrementMeters },
    session: {
      ...session,
      lastUpdatedAtMs: receivedAtMs,
      gps: { anchor: fix, lastAcceptedTimestampMs: fix.timestampMs, segmentId, distanceMeters },
    },
  };
}

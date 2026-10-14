import { requireOptionalNativeModule } from 'expo-modules-core';
export type EnvironmentSnapshot = {
  processToken: string;
  elapsedRealtimeMs: number;
  wallTimeMs: number;
};
export type TrackingSession = {
  runId: string;
  ownerToken: string;
  baseEpochMs: number;
  baseElapsedMs: number;
  collecting: boolean;
  collectionRevision?: number;
  wallOffsetMs?: number;
  phase?: 'starting' | 'active';
  failure: 'location' | 'storage' | null;
};
interface NativeEnvironment {
  snapshot(): EnvironmentSnapshot;
  getSession(): string | null;
  setSession(value: string | null): void;
}
function native() {
  const module = requireOptionalNativeModule<NativeEnvironment>('RunEnvironment');
  if (!module) throw new Error('Android 개발 빌드를 다시 설치해 주세요.');
  return module;
}
export const runEnvironment = {
  snapshot: () => native().snapshot(),
  getSession(): TrackingSession | null {
    const value = native().getSession();
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('runId' in parsed) ||
      typeof parsed.runId !== 'string' ||
      !('ownerToken' in parsed) ||
      typeof parsed.ownerToken !== 'string' ||
      !('baseEpochMs' in parsed) ||
      !Number.isSafeInteger(parsed.baseEpochMs) ||
      !('baseElapsedMs' in parsed) ||
      !Number.isSafeInteger(parsed.baseElapsedMs) ||
      !('collecting' in parsed) ||
      typeof parsed.collecting !== 'boolean' ||
      !('failure' in parsed) ||
      ![null, 'location', 'storage'].includes(parsed.failure as string | null) ||
      ('phase' in parsed && parsed.phase !== 'starting' && parsed.phase !== 'active') ||
      ('wallOffsetMs' in parsed && !Number.isSafeInteger(parsed.wallOffsetMs)) ||
      ('collectionRevision' in parsed &&
        (!Number.isSafeInteger(parsed.collectionRevision) || Number(parsed.collectionRevision) < 0))
    )
      throw new Error('추적 세션 정보를 확인하지 못했어요.');
    return parsed as TrackingSession;
  },
  setSession(value: TrackingSession | null) {
    native().setSession(value ? JSON.stringify(value) : null);
  },
};
export function sessionNow(session: TrackingSession, sample: EnvironmentSnapshot): number {
  if (
    session.ownerToken !== sample.processToken ||
    sample.elapsedRealtimeMs < session.baseElapsedMs
  )
    throw new Error('이전 프로세스의 시간은 이어 계산하지 않습니다.');
  return session.baseEpochMs + sample.elapsedRealtimeMs - session.baseElapsedMs;
}

import * as Location from 'expo-location';
import { backgroundLocation, createNativeRunClock } from '../backgroundLocation';
import { runEnvironment, sessionNow, type TrackingSession } from '../runEnvironment';
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));
jest.mock('../runEnvironment', () => ({
  ...jest.requireActual('../runEnvironment'),
  runEnvironment: { snapshot: jest.fn(), getSession: jest.fn(), setSession: jest.fn() },
}));
let session: TrackingSession | null;
let registered: boolean;
const base = { processToken: 'same', elapsedRealtimeMs: 1000, wallTimeMs: 100000 };
beforeEach(() => {
  jest.clearAllMocks();
  session = null;
  registered = false;
  jest.mocked(runEnvironment.snapshot).mockReturnValue(base);
  jest.mocked(runEnvironment.getSession).mockImplementation(() => session);
  jest.mocked(runEnvironment.setSession).mockImplementation((value) => {
    session = value;
  });
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockImplementation(async () => registered);
  jest.mocked(Location.startLocationUpdatesAsync).mockImplementation(async () => {
    registered = true;
  });
  jest.mocked(Location.stopLocationUpdatesAsync).mockImplementation(async () => {
    registered = false;
  });
});
it('연속 시작은 단일 Task만 등록한다', async () => {
  await Promise.all([backgroundLocation.start('run', base), backgroundLocation.start('run', base)]);
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(session).toMatchObject({ runId: 'run', collecting: true });
});
it('Task 등록 실패는 위치 쓰기를 차단한다', async () => {
  jest.mocked(Location.startLocationUpdatesAsync).mockRejectedValueOnce(new Error('denied'));
  await expect(backgroundLocation.start('run', base)).rejects.toThrow();
  expect(session).toMatchObject({ collecting: false, failure: 'location' });
});
it('Task 중단 실패라도 쓰기 차단 상태를 먼저 저장하고 재시도할 수 있다', async () => {
  await backgroundLocation.start('run', base);
  jest.mocked(Location.stopLocationUpdatesAsync).mockRejectedValueOnce(new Error('stop'));
  await expect(backgroundLocation.stop()).rejects.toThrow();
  expect(session).toMatchObject({ collecting: false });
  await backgroundLocation.stop();
  expect(registered).toBe(false);
});
it('다른 실행 환경의 기존 소유권을 덮어쓰지 않는다', async () => {
  await backgroundLocation.start('run', base);
  await expect(backgroundLocation.start('other', base)).rejects.toThrow();
  expect(session?.runId).toBe('run');
});
it('잠금·벽시계 변경에도 네이티브 단조 시계는 운동 시간을 유지한다', () => {
  const clock = createNativeRunClock();
  jest
    .mocked(runEnvironment.snapshot)
    .mockReturnValue({ ...base, elapsedRealtimeMs: 11000, wallTimeMs: 999999 });
  expect(clock.now()).toBe(110000);
});
it('프로세스나 부팅 기준이 달라지면 이전 시간과 직접 빼지 않는다', () => {
  const lease: TrackingSession = {
    runId: 'run',
    ownerToken: 'same',
    baseElapsedMs: 1000,
    baseEpochMs: 100000,
    collecting: true,
    failure: null,
  };
  expect(() => sessionNow(lease, { ...base, processToken: 'new' })).toThrow();
  expect(() => sessionNow(lease, { ...base, elapsedRealtimeMs: 999 })).toThrow();
});

it('새 러닝의 날짜 기준은 변경된 벽시계에서 다시 잡고 진행 중 기준은 바꾸지 않는다', async () => {
  const clock = createNativeRunClock();
  jest
    .mocked(runEnvironment.snapshot)
    .mockReturnValue({ ...base, elapsedRealtimeMs: 11000, wallTimeMs: 999999 });
  clock.reset();
  expect(clock.now()).toBe(999999);
  await backgroundLocation.start('run', clock.base);
  expect(() => clock.reset()).toThrow();
});

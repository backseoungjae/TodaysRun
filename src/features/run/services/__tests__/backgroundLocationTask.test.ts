import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { handleBackgroundLocations } from '../backgroundLocationTask';
import { backgroundLocation } from '../backgroundLocation';
import { runEnvironment, type TrackingSession } from '../runEnvironment';
import { getDatabase } from '@/database/database';
import { createBackgroundGps } from '../backgroundGps';

jest.mock('expo-task-manager', () => ({
  isTaskDefined: jest.fn().mockReturnValue(false),
  defineTask: jest.fn(),
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));
jest.mock('../backgroundLocation', () => ({
  RUN_LOCATION_TASK: 'todaysrun.location.v1',
  backgroundLocation: { stop: jest.fn() },
}));
jest.mock('../runEnvironment', () => ({
  runEnvironment: { getSession: jest.fn(), setSession: jest.fn(), snapshot: jest.fn() },
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../backgroundGps');
const definitionAtImport = jest.mocked(TaskManager.defineTask).mock.calls[0];
let lease: TrackingSession;
const processBatch = jest.fn();
const point: Location.LocationObject = {
  coords: {
    latitude: 0,
    longitude: 0,
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: 100001,
};
beforeEach(() => {
  jest.clearAllMocks();
  lease = {
    runId: 'run',
    ownerToken: 'owner',
    baseEpochMs: 100000,
    baseElapsedMs: 0,
    collecting: true,
    failure: null,
  };
  jest.mocked(runEnvironment.getSession).mockImplementation(() => lease);
  jest.mocked(runEnvironment.setSession).mockImplementation((value) => {
    if (value) lease = value;
  });
  jest
    .mocked(runEnvironment.snapshot)
    .mockReturnValue({ processToken: 'owner', elapsedRealtimeMs: 1000, wallTimeMs: 101000 });
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  jest
    .mocked(Location.getBackgroundPermissionsAsync)
    .mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(backgroundLocation.stop).mockResolvedValue(undefined);
  jest.mocked(createBackgroundGps).mockReturnValue({ processBatch });
  processBatch.mockResolvedValue({ accepted: 1, rejected: 0 });
});
it('모듈 최상위에서 고정 이름 Task를 정의하고 같은 entry 재호출은 중복 정의하지 않는다', () => {
  expect(definitionAtImport[0]).toBe('todaysrun.location.v1');
  expect(definitionAtImport[1]).toEqual(expect.any(Function));
  jest.requireActual('../backgroundLocationTask');
  expect(TaskManager.defineTask).not.toHaveBeenCalled();
});

it('native 위치 오류는 DB 오류와 구분하며 SQLite를 실행하지 않는다', async () => {
  await handleBackgroundLocations(null, true);
  expect(lease.failure).toBe('location');
  expect(getDatabase).not.toHaveBeenCalled();
});
it('실제 DB 실행 실패는 storage 진단으로 전달한다', async () => {
  processBatch.mockRejectedValueOnce(new Error('disk'));
  await handleBackgroundLocations([point]);
  expect(lease.failure).toBe('storage');
});
it('저장 재시도 성공 뒤 이전 storage 오류를 지운다', async () => {
  lease.failure = 'storage';
  await handleBackgroundLocations([point]);
  expect(lease.failure).toBeNull();
});
it.each(['permission', 'services'] as const)(
  '%s 중단은 추가 쓰기를 막고 Task를 중단한다',
  async (kind) => {
    if (kind === 'permission')
      jest
        .mocked(Location.getBackgroundPermissionsAsync)
        .mockResolvedValue({ granted: false } as Location.LocationPermissionResponse);
    else jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await handleBackgroundLocations([point]);
    expect(lease.failure).toBe('location');
    expect(backgroundLocation.stop).toHaveBeenCalledWith(false);
    expect(getDatabase).not.toHaveBeenCalled();
  },
);
it('새 프로세스로 전달된 Task는 SQLite를 쓰지 않고 등록을 정리한다', async () => {
  jest
    .mocked(runEnvironment.snapshot)
    .mockReturnValue({ processToken: 'new', elapsedRealtimeMs: 1000, wallTimeMs: 101000 });
  await handleBackgroundLocations([point]);
  expect(backgroundLocation.stop).toHaveBeenCalled();
  expect(getDatabase).not.toHaveBeenCalled();
});

it('취소 후 늦게 실패한 권한 조회가 종료된 위치 수집을 다시 활성화하지 않는다', async () => {
  let resolve: (value: Location.LocationPermissionResponse) => void = () => {};
  jest.mocked(Location.getBackgroundPermissionsAsync).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = handleBackgroundLocations([point]);
  lease = { ...lease, collecting: false };
  resolve({
    status: 'denied' as Location.PermissionStatus,
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
  await pending;
  expect(lease.collecting).toBe(false);
  expect(getDatabase).not.toHaveBeenCalled();
  expect(runEnvironment.setSession).not.toHaveBeenCalled();
});
it('이전 구독의 지연 권한 오류가 Resume 후 새 Task를 중단하지 않는다', async () => {
  let resolve: (value: Location.LocationPermissionResponse) => void = () => {};
  lease.collectionRevision = 1;
  jest.mocked(Location.getBackgroundPermissionsAsync).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = handleBackgroundLocations([point]);
  lease = { ...lease, collectionRevision: 2 };
  resolve({
    status: 'denied' as Location.PermissionStatus,
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
  await pending;
  expect(backgroundLocation.stop).not.toHaveBeenCalled();
  expect(lease).toMatchObject({ collecting: true, failure: null, collectionRevision: 2 });
});

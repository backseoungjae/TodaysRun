import { PROPOSED_GPS_POLICY } from '../../domain/gpsPolicy';
import type { GpsFix } from '../../domain/runTypes';
import { createRunPreparation } from '../runPreparation';
import { isReadyLocation } from '../locationReadiness';
import type {
  LocationAdapter,
  LocationPermission,
  PermissionKind,
  PreparationState,
} from '../preparationTypes';

const fix = (extra: Partial<GpsFix> = {}): GpsFix => ({
  latitude: 0,
  longitude: 0,
  accuracyMeters: 5,
  timestampMs: Date.now(),
  ...extra,
});
function fixture(requiresBackgroundPermission = true) {
  let receive: (value: GpsFix) => void = () => {};
  let fail: () => void = () => {};
  const remove = jest.fn();
  const location = {
    getPermission: jest
      .fn<Promise<LocationPermission>, [PermissionKind]>()
      .mockResolvedValue({ granted: true, canAskAgain: true }),
    requestPermission: jest.fn().mockResolvedValue(undefined),
    openSettings: jest.fn().mockResolvedValue(undefined),
    servicesEnabled: jest.fn().mockResolvedValue(true),
    watch: jest.fn<Promise<{ remove(): void }>, [(value: GpsFix) => void, () => void]>(
      async (onFix, onError) => {
        receive = onFix;
        fail = onError;
        return { remove };
      },
    ),
  } satisfies LocationAdapter;
  const states: PreparationState[] = [];
  const deps = {
    location,
    requiresBackgroundPermission,
    backgroundEnabled: jest.fn().mockResolvedValue(true),
    enableBackground: jest.fn().mockResolvedValue(undefined),
    confirm: jest.fn().mockResolvedValue(true),
    now: Date.now,
    onPrepared: jest.fn(),
  };
  const service = createRunPreparation(deps, PROPOSED_GPS_POLICY, (state) => states.push(state));
  return {
    service,
    deps,
    location,
    remove,
    states,
    receive: (value = fix()) => receive(value),
    fail: () => fail(),
  };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
});
afterEach(() => {
  jest.useRealTimers();
});

it('이미 허용된 권한은 재요청 없이 위치를 준비하고 3→2→1 이후 콜백만 호출한다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  expect(f.service.getState()).toEqual({ status: 'waitingForLocation' });
  expect(f.deps.confirm).not.toHaveBeenCalled();
  f.receive();
  await flush();
  await jest.advanceTimersByTimeAsync(3_000);
  await pending;
  expect(f.states.filter((state) => state.status === 'countdown')).toEqual([
    { status: 'countdown', seconds: 3 },
    { status: 'countdown', seconds: 2 },
    { status: 'countdown', seconds: 1 },
  ]);
  expect(f.deps.onPrepared).toHaveBeenCalledTimes(1);
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(f.service.getState()).toEqual({ status: 'idle' });
  expect(jest.getTimerCount()).toBe(0);
});
it.each(['foreground', 'background'] as const)(
  '%s 권한 거절 시 GPS 구독을 생성하지 않는다',
  async (kind) => {
    const f = fixture();
    f.location.getPermission.mockImplementation(async (requested) => ({
      granted: requested !== kind,
      canAskAgain: true,
    }));
    await f.service.start();
    expect(f.service.getState()).toEqual({ status: 'failed', reason: `${kind}-denied` });
    expect(f.location.watch).not.toHaveBeenCalled();
  },
);
it('Android 정책에서는 앱 사용 중 위치 권한만으로 준비하며 백그라운드 권한을 요청하지 않는다', async () => {
  const f = fixture(false);
  f.location.getPermission.mockImplementation(async (kind) => ({
    granted: kind === 'foreground',
    canAskAgain: true,
  }));
  const pending = f.service.start();
  await flush();
  expect(f.service.getState()).toEqual({ status: 'waitingForLocation' });
  expect(f.location.getPermission.mock.calls.every(([kind]) => kind === 'foreground')).toBe(true);
  expect(f.location.requestPermission).not.toHaveBeenCalled();
  expect(f.deps.confirm).not.toHaveBeenCalled();
  f.receive();
  await flush();
  await jest.advanceTimersByTimeAsync(3_000);
  await pending;
  expect(f.deps.onPrepared).toHaveBeenCalledTimes(1);
});
it('다시 요청 불가 권한은 설명 후 설정 이동 및 실제 OS 권한 재조회를 수행한다', async () => {
  const f = fixture();
  let granted = false;
  f.location.getPermission.mockImplementation(async () => ({ granted, canAskAgain: false }));
  f.location.openSettings.mockImplementation(async () => {
    granted = true;
  });
  const pending = f.service.start();
  await flush();
  expect(f.deps.confirm).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(f.location.openSettings).toHaveBeenCalledTimes(1);
  expect(
    f.location.getPermission.mock.calls.filter(([kind]) => kind === 'foreground').length,
  ).toBeGreaterThan(1);
  expect(f.service.getState().status).toBe('waitingForLocation');
  f.service.cancel();
  await pending;
});
it('설정에서 허용하지 않고 돌아온 경우 blocked 상태를 표시한다', async () => {
  const f = fixture();
  f.location.getPermission.mockResolvedValue({ granted: false, canAskAgain: false });
  await f.service.start();
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'foreground-blocked' });
});
it('앱 내부 설정 OFF이면 안내 확인 후 설정을 켜고 위치를 준비한다', async () => {
  const f = fixture();
  f.deps.backgroundEnabled.mockResolvedValue(false);
  f.deps.enableBackground.mockImplementation(async () => {
    f.deps.backgroundEnabled.mockResolvedValue(true);
  });
  const pending = f.service.start();
  await flush();
  expect(f.deps.confirm).toHaveBeenCalledTimes(1);
  expect(f.deps.enableBackground).toHaveBeenCalledTimes(1);
  expect(f.service.getState()).toEqual({ status: 'waitingForLocation' });
  f.service.cancel();
  await pending;
});
it('권한 안내 취소는 권한을 요청하지 않는다', async () => {
  const f = fixture();
  f.location.getPermission.mockResolvedValue({ granted: false, canAskAgain: true });
  f.deps.confirm.mockResolvedValue(false);
  await f.service.start();
  expect(f.service.getState()).toEqual({ status: 'idle' });
  expect(f.location.requestPermission).not.toHaveBeenCalled();
  expect(f.deps.enableBackground).not.toHaveBeenCalled();
  expect(f.location.watch).not.toHaveBeenCalled();
});
it.each([
  { accuracyMeters: 31 },
  { accuracyMeters: Number.NaN },
  { accuracyMeters: -1 },
  { timestampMs: 89_999 },
  { timestampMs: 100_001 },
  { latitude: 91 },
  { longitude: Number.NaN },
])('부정확하거나 오래되거나 잘못된 좌표는 준비 완료로 쓰지 않는다: %j', async (input) => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.receive(fix(input));
  await flush();
  expect(f.service.getState().status).toBe('waitingForLocation');
  f.service.cancel();
  await pending;
});
it('15초 타임아웃에서 구독 제거 후 재시도할 수 있다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  await jest.advanceTimersByTimeAsync(15_000);
  await pending;
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'location-timeout' });
  expect(f.remove).toHaveBeenCalledTimes(1);
  const retry = f.service.start();
  await flush();
  expect(f.location.watch).toHaveBeenCalledTimes(2);
  f.service.cancel();
  await retry;
  expect(jest.getTimerCount()).toBe(0);
});
it('START 연속 클릭은 하나의 요청만 만든다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await f.service.start();
  await flush();
  expect(f.location.watch).toHaveBeenCalledTimes(1);
  f.service.cancel();
  await pending;
});
it('취소 후 늦은 좌표는 상태를 바꾸지 않는다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.service.cancel();
  await pending;
  f.receive();
  await flush();
  expect(f.service.getState()).toEqual({ status: 'idle' });
  expect(f.deps.onPrepared).not.toHaveBeenCalled();
});
it('카운트다운 취소는 완료 콜백을 호출하지 않고 타이머와 구독을 제거한다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.receive();
  await flush();
  f.service.cancel();
  await pending;
  await jest.advanceTimersByTimeAsync(5_000);
  expect(f.deps.onPrepared).not.toHaveBeenCalled();
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it.each([true, false])(
  '백그라운드 권한 필요=%s: 카운트다운 중 권한 철회를 재조회로 감지한다',
  async (requiresBackgroundPermission) => {
    const f = fixture(requiresBackgroundPermission);
    const pending = f.service.start();
    await flush();
    f.receive();
    await flush();
    f.location.getPermission.mockResolvedValue({ granted: false, canAskAgain: true });
    await jest.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(f.service.getState()).toEqual({ status: 'failed', reason: 'permission-revoked' });
    expect(f.deps.onPrepared).not.toHaveBeenCalled();
  },
);
it('카운트다운 중 마지막 위치가 오래되면 안전하게 중단한다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.receive(fix({ timestampMs: 90_500 }));
  await flush();
  await jest.advanceTimersByTimeAsync(1_000);
  await pending;
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'location-lost' });
});
it('위치 서비스 OFF를 차단한다', async () => {
  const f = fixture();
  f.location.servicesEnabled.mockResolvedValue(false);
  await f.service.start();
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'services-off' });
});

it('GPS 대기 중 위치 서비스를 끄면 타임아웃 이전에 중단한다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.location.servicesEnabled.mockResolvedValue(false);
  await jest.advanceTimersByTimeAsync(1_000);
  await pending;
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'services-off' });
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('취소된 이전 요청의 응답은 재시도 중에도 무시한다', async () => {
  const f = fixture();
  const first = f.service.start();
  await flush();
  const oldReceive = f.location.watch.mock.calls[0][0];
  f.service.cancel();
  const retry = f.service.start();
  await flush();
  oldReceive(fix());
  await flush();
  expect(f.service.getState()).toEqual({ status: 'waitingForLocation' });
  f.service.cancel();
  await Promise.all([first, retry]);
  expect(f.deps.onPrepared).not.toHaveBeenCalled();
});
it('네이티브 위치 오류 시 카운트다운을 중단한다', async () => {
  const f = fixture();
  const pending = f.service.start();
  await flush();
  f.receive();
  await flush();
  f.fail();
  await pending;
  expect(f.service.getState()).toEqual({ status: 'failed', reason: 'location-error' });
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(f.deps.onPrepared).not.toHaveBeenCalled();
});
it('취소 후 늦게 생성된 네이티브 구독도 제거한다', async () => {
  const f = fixture();
  let resolve: (handle: { remove(): void }) => void = () => {};
  f.location.watch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = f.service.start();
  await flush();
  f.service.cancel();
  await pending;
  resolve({ remove: f.remove });
  await flush();
  expect(f.remove).toHaveBeenCalledTimes(1);
});
it('GPS 정책은 주입한 정확도 기준으로 조정할 수 있다', () => {
  expect(
    isReadyLocation(fix({ accuracyMeters: 20 }), Date.now(), {
      ...PROPOSED_GPS_POLICY,
      maxAccuracyMeters: 10,
    }),
  ).toBe(false);
  expect(
    isReadyLocation(fix({ accuracyMeters: 10 }), Date.now(), {
      ...PROPOSED_GPS_POLICY,
      maxAccuracyMeters: 10,
    }),
  ).toBe(true);
});

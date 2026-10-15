import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './nodeSqlite';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { createRunStore } from '@/features/run/store/runStore';
import { createRunService } from '@/features/run/services/runService';
import { createRunPreparation } from '@/features/run/services/runPreparation';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import type { GpsFix } from '@/features/run/domain/runTypes';

const fix = (extra: Partial<GpsFix> = {}): GpsFix => ({
  latitude: 0,
  longitude: 0,
  accuracyMeters: 5,
  timestampMs: Date.now(),
  ...extra,
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todaysrun-service-'));
  const db = await openNodeDatabase(join(dir, 'test.db'));
  const runs = createRunRepository(db);
  const locations = createRunLocationRepository(db);
  const store = createRunStore();
  let receive: (value: GpsFix) => void = () => {};
  const remove = jest.fn();
  let sequence = 0;
  const deps = {
    runs,
    locations,
    store,
    now: Date.now,
    makeId: () => `run-${++sequence}`,
    canStart: jest.fn().mockResolvedValue(true),
    navigateRunning: jest.fn().mockResolvedValue(undefined),
    location: {
      watch: jest.fn(async (callback: (value: GpsFix) => void) => {
        receive = callback;
        return { remove };
      }),
    },
  };
  const service = createRunService(deps, PROPOSED_GPS_POLICY);
  const f = {
    db,
    runs,
    locations,
    store,
    deps,
    service,
    remove,
    receive: async (value = fix()) => {
      receive(value);
      await service.drain();
    },
    start: () => service.start(fix(), new AbortController().signal),
    close: async () => {
      service.dispose();
      await service.drain();
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  fixtures.push(f);
  return f;
}
const fixtures: { close(): Promise<void> }[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  jest.useRealTimers();
});
async function flush() {
  for (let i = 0; i < 120; i++) await Promise.resolve();
}

it('카운트다운 완료 후에만 실제 SQLite 러닝을 만들고 화면에 진입한다', async () => {
  const f = await fixture();
  let receive: (value: GpsFix) => void = () => {};
  const preparation = createRunPreparation(
    {
      backgroundEnabled: async () => true,
      enableBackground: async () => {},
      confirm: async () => true,
      now: Date.now,
      location: {
        getPermission: async () => ({ granted: true, canAskAgain: true }),
        requestPermission: async () => {},
        openSettings: async () => {},
        servicesEnabled: async () => true,
        watch: async (callback) => {
          receive = callback;
          return { remove() {} };
        },
      },
      onPrepared: (value, signal) => f.service.start(value, signal),
    },
    PROPOSED_GPS_POLICY,
    () => {},
  );
  const pending = preparation.start();
  await flush();
  receive(fix());
  await flush();
  expect(await f.runs.findUnfinished()).toEqual([]);
  await jest.advanceTimersByTimeAsync(2_999);
  expect(await f.runs.findUnfinished()).toEqual([]);
  await jest.advanceTimersByTimeAsync(1);
  await pending;
  expect((await f.runs.findUnfinished())[0].startedAtMs).toBe(103_000);
  expect(f.store.getState().durationMs).toBe(0);
  expect(f.deps.navigateRunning).toHaveBeenCalledTimes(1);
});
it('연속 시작은 러닝과 구독을 하나만 만든다', async () => {
  const f = await fixture();
  await Promise.all([f.start(), f.start()]);
  expect(await f.runs.findUnfinished()).toHaveLength(1);
  expect(f.deps.location.watch).toHaveBeenCalledTimes(1);
});
it('DB 시작 실패 시 화면 진입과 GPS 구독을 차단하며 재시도한다', async () => {
  const f = await fixture();
  jest.spyOn(f.runs, 'create').mockRejectedValueOnce(new Error('disk-full'));
  await expect(f.start()).rejects.toThrow('disk-full');
  expect(f.deps.navigateRunning).not.toHaveBeenCalled();
  expect(f.deps.location.watch).not.toHaveBeenCalled();
  await f.start();
  expect(f.store.getState().status).toBe('RUNNING');
});
it.each(['watch', 'navigation'] as const)(
  '%s 시작 실패 시 해당 신규 기록을 정리한다',
  async (failure) => {
    const f = await fixture();
    if (failure === 'watch') f.deps.location.watch.mockRejectedValueOnce(new Error('watch-error'));
    else f.deps.navigateRunning.mockRejectedValueOnce(new Error('navigation-error'));
    await expect(f.start()).rejects.toThrow();
    expect(await f.runs.findUnfinished()).toEqual([]);
    expect(f.store.getState().id).toBeNull();
  },
);
it('시작 실패 정리까지 실패하면 미완료 기록을 보존하고 새 러닝을 차단한다', async () => {
  const f = await fixture();
  f.deps.location.watch.mockRejectedValueOnce(new Error('watch-error'));
  jest.spyOn(f.runs, 'deleteById').mockRejectedValueOnce(new Error('disk-full'));
  await expect(f.start()).rejects.toThrow('미완료');
  expect(await f.runs.findUnfinished()).toHaveLength(1);
  await expect(f.start()).rejects.toThrow('미완료');
});
it('앱 재시작 시 기존 미완료 기록을 덮어쓰지 않는다', async () => {
  const f = await fixture();
  await f.start();
  const another = createRunService({ ...f.deps, store: createRunStore() }, PROPOSED_GPS_POLICY);
  await expect(another.start(fix(), new AbortController().signal)).rejects.toThrow('미완료');
  another.dispose();
});
it('유효 GPS만 거리·경로에 반영하고 중복·순간 이동은 제외한다', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  await jest.advanceTimersByTimeAsync(1_000);
  const next = fix({ longitude: 0.00005 });
  await f.receive(next);
  await f.receive(next);
  await f.receive(fix({ latitude: 91 }));
  await f.receive(fix({ accuracyMeters: 100 }));
  await jest.advanceTimersByTimeAsync(1_000);
  await f.receive(fix({ longitude: 1 }));
  expect(f.store.getState().distanceMeters).toBeCloseTo(5.5597, 3);
  expect(await f.locations.listForRun('run-1')).toHaveLength(2);
  expect((await f.runs.findById('run-1'))?.distanceMeters).toBe(f.store.getState().distanceMeters);
});
it('GPS Transaction 실패 시 표시 상태는 바뀌지 않으며 다음 저장은 재시도할 수 있다', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  await jest.advanceTimersByTimeAsync(1_000);
  await f.db.write(async (txn) => {
    await txn.execAsync(
      `CREATE TRIGGER fail_gps BEFORE UPDATE OF distance_meters ON runs WHEN NEW.distance_meters>OLD.distance_meters BEGIN SELECT RAISE(ABORT,'test'); END;`,
    );
  });
  const next = fix({ longitude: 0.00005 });
  await f.receive(next);
  expect(f.store.getState().distanceMeters).toBe(0);
  expect(f.store.getState().path).toHaveLength(1);
  expect(await f.locations.listForRun('run-1')).toHaveLength(1);
  await f.db.write(async (txn) => {
    await txn.execAsync('DROP TRIGGER fail_gps');
  });
  await f.receive(next);
  expect(f.store.getState().distanceMeters).toBeGreaterThan(5);
});
it('GPS 손실 이후 구간은 새로 시작하며 첫 좌표의 거리는 0이다', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  await jest.advanceTimersByTimeAsync(30_000);
  await f.receive(fix({ longitude: 1 }));
  expect(f.store.getState().path.map((point) => point.segmentId)).toEqual([0, 1]);
  expect(f.store.getState().distanceMeters).toBe(0);
});
it('Pause 중 시간·거리 불변, Resume 이후 새 경로 구간과 누적 시간 유지', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  await jest.advanceTimersByTimeAsync(6_000);
  await f.service.pause();
  const late = f.deps.location.watch.mock.calls[0][0];
  await jest.advanceTimersByTimeAsync(10_000);
  late(fix({ longitude: 1 }));
  await f.service.drain();
  expect(f.store.getState().durationMs).toBe(6_000);
  expect(f.store.getState().distanceMeters).toBe(0);
  await f.service.resume();
  await f.receive(fix({ longitude: 1 }));
  await jest.advanceTimersByTimeAsync(2_000);
  expect(f.store.getState().durationMs).toBe(8_000);
  expect(f.store.getState().path.map((p) => p.segmentId)).toEqual([0, 1]);
});
it('5초 체크포인트를 저장하고 표시 타이머는 지도 데이터 참조를 바꾸지 않는다', async () => {
  const f = await fixture();
  await f.start();
  const path = f.store.getState().path;
  const current = f.store.getState().current;
  const checkpoint = jest.spyOn(f.runs, 'saveCheckpoint');
  await jest.advanceTimersByTimeAsync(5_000);
  await f.service.drain();
  expect(checkpoint).toHaveBeenCalledTimes(1);
  expect((await f.runs.findById('run-1'))?.activeDurationMs).toBe(5_000);
  expect(f.store.getState().path).toBe(path);
  expect(f.store.getState().current).toBe(current);
});
it('완료 저장 실패는 PAUSED를 유지하고 재시도 후 실제 기록을 완료한다', async () => {
  const f = await fixture();
  await f.start();
  await jest.advanceTimersByTimeAsync(3_000);
  await f.service.pause();
  jest.spyOn(f.runs, 'saveTransition').mockRejectedValueOnce(new Error('disk-full'));
  await expect(f.service.finish()).rejects.toThrow();
  expect(f.store.getState().status).toBe('PAUSED');
  expect((await f.runs.findById('run-1'))?.status).toBe('paused');
  await f.service.finish();
  const saved = await f.runs.findById('run-1');
  expect(saved?.status).toBe('completed');
  expect(saved?.completionReason).toBe('normal');
  expect(saved?.activeDurationMs).toBe(3_000);
});
it('연속 종료는 한 번 저장하며 완료 이후 늦은 GPS는 무시한다', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  const late = f.deps.location.watch.mock.calls[0][0];
  await f.service.pause();
  const save = jest.spyOn(f.runs, 'saveTransition');
  await Promise.all([f.service.finish(), f.service.finish()]);
  late(fix({ longitude: 1 }));
  await f.service.drain();
  expect(save).toHaveBeenCalledTimes(1);
  expect(await f.locations.listForRun('run-1')).toHaveLength(1);
});
it('앱 전환은 구독만 중단하고 복귀 후 경로를 분리하며 화면 해제와 무관하게 세션을 보존한다', async () => {
  const f = await fixture();
  await f.start();
  await f.receive();
  await f.service.setForeground(false);
  await jest.advanceTimersByTimeAsync(2_000);
  await f.receive(fix({ longitude: 1 }));
  await f.service.setForeground(true);
  await f.receive(fix({ longitude: 1 }));
  expect(f.store.getState().status).toBe('RUNNING');
  expect(f.store.getState().path.map((p) => p.segmentId)).toEqual([0, 1]);
});

it('진행 중 Service 세션은 Store를 비워도 기록 삭제를 차단한다', async () => {
  const f = await fixture();
  await f.start();
  f.store.setState({ status: null, id: null });
  const remove = jest.fn(async () => {});
  expect(f.service.hasActiveRun()).toBe(true);
  await expect(f.service.manageRecords(remove)).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
});
it('기록 관리 중에는 새 러닝 시작과 중복 관리를 차단한다', async () => {
  const f = await fixture();
  let resolve!: () => void;
  const pending = f.service.manageRecords(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await flush();
  await f.start();
  expect(await f.runs.findUnfinished()).toEqual([]);
  await expect(f.service.manageRecords(async () => {})).rejects.toThrow();
  resolve();
  await pending;
  await f.start();
  expect(await f.runs.findUnfinished()).toHaveLength(1);
});

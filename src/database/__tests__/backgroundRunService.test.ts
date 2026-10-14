import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './nodeSqlite';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { restoreRunSession } from '../runSessionSnapshot';
import { createRunStore } from '@/features/run/store/runStore';
import { createRunSession, transitionRunSession } from '@/features/run/domain/runSession';
import { createRunService } from '@/features/run/services/runService';
import { createBackgroundGps } from '@/features/run/services/backgroundGps';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import type { TrackingSession } from '@/features/run/services/runEnvironment';
const fix = (timestampMs = Date.now(), longitude = 0) => ({
  latitude: 0,
  longitude,
  accuracyMeters: 5,
  timestampMs,
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todaysrun-bg-service-'));
  const db = await openNodeDatabase(join(dir, 'run.db'));
  const runs = createRunRepository(db),
    locations = createRunLocationRepository(db),
    store = createRunStore();
  let lease: TrackingSession | null = null;
  const source = {
    start: jest.fn(async (runId: string) => {
      lease = {
        runId,
        ownerToken: 'process',
        baseEpochMs: 100000,
        baseElapsedMs: 0,
        collecting: true,
        failure: null,
      };
    }),
    stop: jest.fn(async () => {
      if (lease) lease = { ...lease, collecting: false };
    }),
    clear: () => {
      lease = null;
    },
    reload: jest.fn(async (id: string) => {
      const saved = await locations.loadSession(id);
      return {
        session: restoreRunSession(saved.run, saved.path.at(-1) ?? null),
        path: saved.path,
        error: null,
      };
    }),
    checkpoint: async (id: string) => runs.checkpointCurrent(id, () => Date.now()),
  };
  const watch = jest.fn(async () => ({ remove: jest.fn() })),
    navigate = jest.fn(async () => {});
  let sequence = 0;
  const service = createRunService(
    {
      runs,
      locations,
      store,
      location: { watch },
      background: source,
      now: Date.now,
      canStart: async () => true,
      makeId: () => `run-${++sequence}`,
      navigateRunning: navigate,
    },
    PROPOSED_GPS_POLICY,
  );
  const engine = createBackgroundGps(
    {
      runs,
      locations,
      getSession: () => lease,
      snapshot: () => ({
        processToken: 'process',
        elapsedRealtimeMs: Date.now() - 100000,
        wallTimeMs: Date.now(),
      }),
    },
    PROPOSED_GPS_POLICY,
  );
  const f = {
    db,
    runs,
    locations,
    store,
    source,
    watch,
    navigate,
    service,
    engine,
    disableWrites: () => {
      if (lease) lease = { ...lease, collecting: false };
    },
    start: () => service.start(fix(), new AbortController().signal),
    async close() {
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
  jest.setSystemTime(100000);
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  jest.useRealTimers();
});
it('실제 러닝의 위치 수집은 Task 하나이며 기존 watch 구독을 병행하지 않는다', async () => {
  const f = await fixture();
  await f.start();
  expect(f.source.start).toHaveBeenCalledTimes(1);
  expect(f.watch).not.toHaveBeenCalled();
});
it('앱 전환 중 Task를 중단하지 않고 복귀하면 최신 DB 거리·경로와 ID를 복원한다', async () => {
  const f = await fixture();
  await f.start();
  await f.service.setForeground(false);
  jest.advanceTimersByTime(2000);
  await f.engine.processBatch([fix(100001), fix(100201, 0.00001)]);
  expect(f.store.getState().path).toHaveLength(0);
  await f.service.setForeground(true);
  expect(f.store.getState()).toMatchObject({ id: 'run-1', status: 'RUNNING', durationMs: 2000 });
  expect(f.store.getState().path).toHaveLength(2);
  expect(f.source.start).toHaveBeenCalledTimes(1);
  expect(f.source.stop).not.toHaveBeenCalled();
});
it('화면 메모리가 비어도 살아 있는 세션을 SQLite에서 연결할 수 있다', async () => {
  const f = await fixture();
  await f.start();
  f.service.dispose();
  jest.advanceTimersByTime(2000);
  await f.engine.processBatch([fix(100001), fix(100201, 0.00001)]);
  const store = createRunStore();
  const actor = createRunService(
    {
      runs: f.runs,
      locations: f.locations,
      store,
      background: f.source,
      location: { watch: f.watch },
      now: Date.now,
      canStart: async () => true,
      makeId: () => 'other',
      navigateRunning: f.navigate,
    },
    PROPOSED_GPS_POLICY,
  );
  try {
    await Promise.all([actor.attach('run-1'), actor.attach('run-1')]);
    expect(store.getState()).toMatchObject({ id: 'run-1', status: 'RUNNING', durationMs: 2000 });
    expect(store.getState().path).toHaveLength(2);
    expect(f.source.start).toHaveBeenCalledTimes(1);
    expect(await f.runs.findUnfinished()).toHaveLength(1);
  } finally {
    actor.dispose();
    await actor.drain();
  }
});
it('복구 전 미완료 기록이 남으면 새 세션과 Task를 생성하지 않는다', async () => {
  const f = await fixture();
  let session = createRunSession();
  for (const type of ['BEGIN_COUNTDOWN', 'START'] as const) {
    const result = transitionRunSession(session, {
      type,
      atMs: 90000,
      expectedRevision: session.revision,
    });
    if (!result.accepted) throw new Error(result.reason);
    session = result.session;
  }
  await f.runs.create('old-process', session);
  await expect(f.start()).rejects.toThrow('미완료 기록');
  expect(f.source.start).not.toHaveBeenCalled();
  expect(f.navigate).not.toHaveBeenCalled();
  expect((await f.runs.findUnfinished()).map((r) => r.id)).toEqual(['old-process']);
});
it('Task 등록 실패는 Running 진입을 차단하고 신규 시작 기록만 정리한다', async () => {
  const f = await fixture();
  f.source.start.mockRejectedValueOnce(new Error('task-register'));
  await expect(f.start()).rejects.toThrow();
  expect(f.navigate).not.toHaveBeenCalled();
  expect(await f.runs.findUnfinished()).toEqual([]);
});
it('Task 중단 실패는 PAUSED로 거짓 전환하지 않고 추가 위치 쓰기는 차단한다', async () => {
  const f = await fixture();
  await f.start();
  f.source.stop.mockImplementationOnce(async () => {
    f.disableWrites();
    throw new Error('stop');
  });
  await expect(f.service.pause()).rejects.toThrow();
  expect((await f.runs.findById('run-1'))?.status).toBe('running');
  jest.advanceTimersByTime(2000);
  await f.engine.processBatch([fix()]);
  expect(await f.locations.listForRun('run-1')).toEqual([]);
  await f.service.pause();
  expect((await f.runs.findById('run-1'))?.status).toBe('paused');
});
it('Finish에서 Task 중단 실패는 완료 저장을 하지 않고 재시도를 허용한다', async () => {
  const f = await fixture();
  await f.start();
  await f.service.pause();
  f.source.stop.mockRejectedValueOnce(new Error('stop'));
  await expect(f.service.finish()).rejects.toThrow();
  expect((await f.runs.findById('run-1'))?.status).toBe('paused');
  expect(await f.service.finish()).toBe('run-1');
  expect((await f.runs.findById('run-1'))?.status).toBe('completed');
});
it('최종 DB 저장 실패 뒤에도 PAUSED와 원래 누적 시간이 유지된다', async () => {
  const f = await fixture();
  await f.start();
  jest.advanceTimersByTime(2000);
  await f.service.pause();
  jest.spyOn(f.runs, 'saveTransition').mockRejectedValueOnce(new Error('disk-full'));
  await expect(f.service.finish()).rejects.toThrow();
  jest.advanceTimersByTime(20000);
  expect((await f.runs.findById('run-1'))?.activeDurationMs).toBe(2000);
  await f.service.finish();
  expect((await f.runs.findById('run-1'))?.activeDurationMs).toBe(2000);
});
it('Resume 뒤 새 Task 구간은 Pause 전 좌표와 연결하지 않는다', async () => {
  const f = await fixture();
  await f.start();
  jest.advanceTimersByTime(1000);
  await f.engine.processBatch([fix(100001)]);
  await f.service.pause();
  jest.advanceTimersByTime(10000);
  await f.service.resume();
  jest.advanceTimersByTime(1000);
  await f.engine.processBatch([fix(111001, 0.01)]);
  const path = await f.locations.listForRun('run-1');
  expect(path.at(-1)).toMatchObject({ segmentIndex: 1, distanceDeltaMeters: 0 });
  await f.service.setForeground(true);
  expect(f.store.getState().durationMs).toBe(2000);
});

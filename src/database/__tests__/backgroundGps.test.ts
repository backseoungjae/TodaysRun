import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase, openNodeWorkerDatabase } from './nodeSqlite';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { createRunSession, transitionRunSession } from '@/features/run/domain/runSession';
import type { RunSession, RunEvent, GpsFix } from '@/features/run/domain/runTypes';
import { createBackgroundGps, GpsClockError } from '@/features/run/services/backgroundGps';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import { restoreRunSession } from '../runSessionSnapshot';
import type { EnvironmentSnapshot, TrackingSession } from '@/features/run/services/runEnvironment';

function move(session: RunSession, type: RunEvent['type'], atMs: number) {
  const result = transitionRunSession(session, { type, atMs, expectedRevision: session.revision });
  if (!result.accepted) throw new Error(result.reason);
  return result.session;
}
const fix = (timestampMs: number, longitude = 0, extra: Partial<GpsFix> = {}): GpsFix => ({
  latitude: 0,
  longitude,
  accuracyMeters: 5,
  timestampMs,
  ...extra,
});
async function fixture(worker = false) {
  const dir = mkdtempSync(join(tmpdir(), 'todaysrun-background-'));
  const db = await (worker ? openNodeWorkerDatabase : openNodeDatabase)(join(dir, 'background.db'));
  const runs = createRunRepository(db),
    locations = createRunLocationRepository(db);
  const session = move(move(createRunSession(), 'BEGIN_COUNTDOWN', 99_999), 'START', 100_000);
  await runs.create('run', session);
  let lease: TrackingSession = {
    runId: 'run',
    ownerToken: 'process',
    baseEpochMs: 100_000,
    baseElapsedMs: 1_000,
    collecting: true,
    failure: null,
    wallOffsetMs: 0,
  };
  let sample: EnvironmentSnapshot = {
    processToken: 'process',
    elapsedRealtimeMs: 2_000,
    wallTimeMs: 101_000,
  };
  const engine = createBackgroundGps(
    { runs, locations, getSession: () => lease, snapshot: () => sample },
    PROPOSED_GPS_POLICY,
  );
  const f = {
    db,
    runs,
    locations,
    engine,
    setNow(ms: number) {
      sample = { ...sample, elapsedRealtimeMs: 1000 + ms - 100_000, wallTimeMs: ms };
    },
    setLease(extra: Partial<TrackingSession>) {
      lease = { ...lease, ...extra };
    },
    setSample(extra: Partial<EnvironmentSnapshot>) {
      sample = { ...sample, ...extra };
    },
    async snapshot() {
      const value = await locations.loadSession('run');
      return { ...value, session: restoreRunSession(value.run, value.path.at(-1) ?? null) };
    },
    async close() {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  fixtures.push(f);
  return f;
}
const fixtures: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
it('활성 Task는 실제 SQLite에 좌표·거리·시간을 함께 저장한다', async () => {
  const f = await fixture();
  expect(await f.engine.processBatch([fix(100_001), fix(100_201, 0.00001)])).toEqual({
    accepted: 2,
    rejected: 0,
  });
  const saved = await f.snapshot();
  expect(saved.path).toHaveLength(2);
  expect(saved.run.distanceMeters).toBeCloseTo(1.112, 2);
  expect(saved.run.activeDurationMs).toBe(1000);
});
it('신선한 마지막 샘플을 포함한 지연 배치는 원래 측정 순서와 구간을 유지한다', async () => {
  const f = await fixture();
  f.setNow(121_000);
  expect(
    await f.engine.processBatch([fix(120_001, 0.00002), fix(100_001), fix(110_001, 0.00001)]),
  ).toEqual({ accepted: 3, rejected: 0 });
  const saved = await f.snapshot();
  expect(saved.path.map((p) => p.recordedAtMs)).toEqual([100_001, 110_001, 120_001]);
  expect(saved.path.map((p) => p.segmentIndex)).toEqual([0, 0, 0]);
  expect(saved.run.activeDurationMs).toBe(21_000);
});
it('실제로 오래된 캐시 배치는 거리를 늘리지 않지만 확인된 실행 시간은 저장한다', async () => {
  const f = await fixture();
  f.setNow(130_000);
  expect((await f.engine.processBatch([fix(100_001)])).accepted).toBe(0);
  expect((await f.snapshot()).path).toEqual([]);
  expect((await f.snapshot()).run.activeDurationMs).toBe(30_000);
});
it('중복·이전 시각 GPS는 재저장되지 않는다', async () => {
  const f = await fixture();
  await f.engine.processBatch([fix(100_001), fix(100_201, 0.00001)]);
  const distance = (await f.snapshot()).run.distanceMeters;
  expect((await f.engine.processBatch([fix(100_201, 0.00001), fix(100_001)])).accepted).toBe(0);
  expect((await f.snapshot()).run.distanceMeters).toBe(distance);
  expect((await f.snapshot()).path).toHaveLength(2);
});
it('부정확한 좌표·잘못된 좌표·순간 이동은 거리 증가에서 제외한다', async () => {
  const f = await fixture();
  await f.engine.processBatch([fix(100_001)]);
  const result = await f.engine.processBatch([
    fix(100_100, 1),
    fix(100_200, 0, { latitude: 100 }),
    fix(100_300, 0, { accuracyMeters: 100 }),
  ]);
  expect(result.accepted).toBe(0);
  expect((await f.snapshot()).run.distanceMeters).toBe(0);
});
it.each(['PAUSE', 'FINISH'] as const)('%s 이후 늦은 Task 위치는 저장하지 않는다', async (type) => {
  const f = await fixture();
  const row = await f.snapshot();
  const next = move(row.session, type, 101_000);
  await f.runs.saveTransition('run', next, 101_000, row.session.revision);
  f.setNow(102_000);
  await f.engine.processBatch([fix(102_000)]);
  expect((await f.snapshot()).path).toEqual([]);
  expect((await f.snapshot()).run.activeDurationMs).toBe(1000);
});
it('Pause/Resume 뒤의 첫 위치는 0m 새 구간으로 시작한다', async () => {
  const f = await fixture();
  await f.engine.processBatch([fix(100_001), fix(100_201, 0.00001)]);
  let saved = await f.snapshot();
  let next = move(saved.session, 'PAUSE', 102_000);
  await f.runs.saveTransition('run', next, 102_000, saved.session.revision);
  saved = await f.snapshot();
  next = move(saved.session, 'RESUME', 110_000);
  await f.runs.saveTransition('run', next, 110_000, saved.session.revision);
  f.setNow(111_000);
  await f.engine.processBatch([fix(110_001, 0.01)]);
  const final = await f.snapshot();
  expect(final.path.at(-1)).toMatchObject({ segmentIndex: 1, distanceDeltaMeters: 0 });
  expect(final.run.activeDurationMs).toBe(3000);
});
it('장시간 신호 손실 뒤 좌표는 새 구간으로 분리된다', async () => {
  const f = await fixture();
  await f.engine.processBatch([fix(100_001)]);
  f.setNow(140_000);
  await f.engine.processBatch([fix(140_000, 1)]);
  expect((await f.snapshot()).path.at(-1)).toMatchObject({
    segmentIndex: 1,
    distanceDeltaMeters: 0,
  });
});
it('서로 다른 SQLite 연결이 같은 이벤트를 처리해도 한 번만 저장한다', async () => {
  const f = await fixture(true);
  const file = await f.db.read((sql) => sql.getAllAsync('PRAGMA database_list'));
  const path = (file[0] as { file: string }).file;
  const other = await openNodeWorkerDatabase(path);
  try {
    const engine = createBackgroundGps(
      {
        runs: createRunRepository(other),
        locations: createRunLocationRepository(other),
        getSession: () => ({
          runId: 'run',
          ownerToken: 'process',
          baseEpochMs: 100000,
          baseElapsedMs: 1000,
          collecting: true,
          failure: null,
        }),
        snapshot: () => ({ processToken: 'process', elapsedRealtimeMs: 2000, wallTimeMs: 101000 }),
      },
      PROPOSED_GPS_POLICY,
    );
    await Promise.all([f.engine.processBatch([fix(100001)]), engine.processBatch([fix(100001)])]);
    expect((await f.snapshot()).path).toHaveLength(1);
  } finally {
    await other.close();
  }
});
it('Task Transaction 실패는 위치·거리·시간 전체를 롤백한다', async () => {
  const f = await fixture();
  await f.db.write((sql) =>
    sql.execAsync(
      "CREATE TRIGGER fail_point AFTER INSERT ON run_locations BEGIN SELECT RAISE(ABORT,'simulated'); END;",
    ),
  );
  await expect(f.engine.processBatch([fix(100001)])).rejects.toThrow();
  const saved = await f.snapshot();
  expect(saved.path).toEqual([]);
  expect(saved.run.distanceMeters).toBe(0);
  expect(saved.run.activeDurationMs).toBe(0);
});
it('새 프로세스·다른 세션·쓰기 차단 상태에서는 DB를 갱신하지 않는다', async () => {
  const f = await fixture();
  f.setLease({ collecting: false });
  await f.engine.processBatch([fix(100001)]);
  f.setLease({ collecting: true, runId: 'other' });
  await expect(f.engine.processBatch([fix(100001)])).rejects.toThrow();
  f.setLease({ runId: 'run' });
  f.setSample({ processToken: 'new-process', wallTimeMs: 500000 });
  await f.engine.processBatch([fix(500000)]);
  expect((await f.snapshot()).run.activeDurationMs).toBe(0);
});
it('시각 변경은 서로 다른 시계로 GPS 속도를 계산하지 않고 안전하게 제외한다', async () => {
  const f = await fixture();
  f.setSample({ wallTimeMs: 3_701_000 });
  await expect(f.engine.processBatch([fix(3_701_000)])).rejects.toBeInstanceOf(GpsClockError);
  expect((await f.snapshot()).run.distanceMeters).toBe(0);
});

it('벽시계 샘플의 1ms 오차가 동일 GPS 이벤트를 새로운 이벤트로 바꾸지 않는다', async () => {
  const f = await fixture();
  await f.engine.processBatch([fix(100001), fix(100201, 0.00001)]);
  f.setSample({ wallTimeMs: 100999 });
  await f.engine.processBatch([fix(100201, 0.00001)]);
  expect((await f.snapshot()).path).toHaveLength(2);
});

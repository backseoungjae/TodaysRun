import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './nodeSqlite';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { createAppSettingsRepository } from '../repositories/appSettingsRepository';
import { createRunSession, transitionRunSession } from '@/features/run/domain/runSession';
import type { RunSession, RunEvent } from '@/features/run/domain/runTypes';
import { createRunRecovery } from '@/features/run/services/runRecovery';
import { createBackgroundGps } from '@/features/run/services/backgroundGps';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import type { TrackingSession } from '@/features/run/services/runEnvironment';
function move(session: RunSession, type: RunEvent['type'], atMs: number) {
  const result = transitionRunSession(session, { type, atMs, expectedRevision: session.revision });
  if (!result.accepted) throw new Error(result.reason);
  return result.session;
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todaysrun-recovery-'));
  const db = await openNodeDatabase(join(dir, 'recovery.db'));
  const runs = createRunRepository(db),
    locations = createRunLocationRepository(db),
    settings = createAppSettingsRepository(db);
  const started = move(move(createRunSession(), 'BEGIN_COUNTDOWN', 99000), 'START', 100000);
  let lease: TrackingSession | null = {
    runId: 'unfinished',
    ownerToken: 'old-process',
    baseEpochMs: 100000,
    baseElapsedMs: 1000,
    collecting: true,
    failure: null,
    phase: 'active',
  };
  let processToken = 'new-process';
  let registered = true;
  const stop = jest.fn(async () => {
    registered = false;
    if (lease) lease = { ...lease, collecting: false };
  });
  const clear = jest.fn(() => {
    lease = null;
  });
  const snapshot = () => ({ processToken, elapsedRealtimeMs: 50000, wallTimeMs: 900000 });
  const recovery = createRunRecovery({
    runs,
    snapshot,
    getSession: () => lease,
    registered: async () => registered,
    stop,
    clear,
  });
  const f = {
    db,
    runs,
    locations,
    settings,
    started,
    recovery,
    stop,
    clear,
    snapshot,
    getSession: () => lease,
    own() {
      processToken = 'old-process';
    },
    loseLease() {
      lease = null;
    },
    create: async () => {
      await runs.create('unfinished', started);
      await runs.saveCheckpoint('unfinished', started, 105000);
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
it('미완료 기록이 없으면 남아 있는 Task만 정리한다', async () => {
  const f = await fixture();
  expect(await f.recovery.inspect()).toEqual({ kind: 'none' });
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(await f.runs.listCompleted()).toEqual([]);
});
it('같은 네이티브 프로세스의 살아 있는 세션은 복구 종료하지 않는다', async () => {
  const f = await fixture();
  await f.create();
  f.own();
  expect(await f.recovery.inspect()).toMatchObject({ kind: 'owned', record: { id: 'unfinished' } });
  expect(f.stop).not.toHaveBeenCalled();
});
it.each(['running', 'paused'] as const)(
  '%s 기록은 새 프로세스에서 선택 전까지 그대로 보존한다',
  async (status) => {
    const f = await fixture();
    await f.create();
    if (status === 'paused')
      await f.runs.saveTransition(
        'unfinished',
        move(f.started, 'PAUSE', 106000),
        106000,
        f.started.revision,
      );
    const before = await f.runs.findById('unfinished');
    expect(await f.recovery.inspect()).toMatchObject({ kind: 'required', ambiguous: false });
    expect(f.stop).toHaveBeenCalled();
    expect(await f.runs.findById('unfinished')).toEqual(before);
  },
);
it('소유권 정보가 없는 경우 자동 삭제·완료하지 않고 불명확 상태를 알린다', async () => {
  const f = await fixture();
  await f.create();
  f.loseLease();
  expect(await f.recovery.inspect()).toMatchObject({ kind: 'required', ambiguous: true });
  expect((await f.runs.findById('unfinished'))?.status).toBe('running');
});
it('복구 저장은 0km 기록과 마지막 5초만 보관하고 미기록 시간을 더하지 않는다', async () => {
  const f = await fixture();
  await f.create();
  const saved = await f.recovery.save('unfinished');
  expect(saved).toMatchObject({
    status: 'completed',
    completionReason: 'recovered',
    activeDurationMs: 5000,
    distanceMeters: 0,
    endedAtMs: 105000,
  });
  expect(await f.locations.listForRun('unfinished')).toEqual([]);
  expect(await f.recovery.inspect()).toEqual({ kind: 'none' });
});
it('PAUSED 복구는 일시정지 이후 시간을 더하지 않는다', async () => {
  const f = await fixture();
  await f.create();
  await f.runs.saveTransition(
    'unfinished',
    move(f.started, 'PAUSE', 106000),
    106000,
    f.started.revision,
  );
  expect(await f.recovery.save('unfinished')).toMatchObject({
    activeDurationMs: 6000,
    endedAtMs: 106000,
  });
});
it('복구 저장 재호출은 동일 상태 버전과 기록을 반환한다', async () => {
  const f = await fixture();
  await f.create();
  const first = await f.recovery.save('unfinished');
  expect(await f.recovery.save('unfinished')).toEqual(first);
  expect(await f.runs.listCompleted()).toHaveLength(1);
});
it('복구 Task 중단 실패는 DB를 변경하지 않고 재시도할 수 있다', async () => {
  const f = await fixture();
  await f.create();
  const before = await f.runs.findById('unfinished');
  f.stop.mockRejectedValueOnce(new Error('stop'));
  await expect(f.recovery.save('unfinished')).rejects.toThrow('stop');
  expect(await f.runs.findById('unfinished')).toEqual(before);
  expect(await f.recovery.save('unfinished')).toMatchObject({ status: 'completed' });
});
it('복구 DB 저장 실패는 실제 Transaction을 롤백하고 재시도한다', async () => {
  const f = await fixture();
  await f.create();
  await f.db.write((sql) =>
    sql.execAsync(
      "CREATE TRIGGER fail_recovery BEFORE UPDATE OF status ON runs BEGIN SELECT RAISE(ABORT,'disk-full'); END;",
    ),
  );
  await expect(f.recovery.save('unfinished')).rejects.toThrow();
  expect((await f.runs.findById('unfinished'))?.status).toBe('running');
  await f.db.write((sql) => sql.execAsync('DROP TRIGGER fail_recovery'));
  expect(await f.recovery.save('unfinished')).toMatchObject({ status: 'completed' });
});
it('복구 삭제는 경로를 Cascade 삭제하고 기존 완료 기록·설정·버전을 유지한다', async () => {
  const f = await fixture();
  await f.create();
  await f.db.write(async (sql) => {
    await sql.runAsync(
      'INSERT INTO run_locations(run_id,latitude,longitude,accuracy_meters,recorded_at_ms,segment_index,distance_delta_meters) VALUES(?,0,0,5,100001,0,0)',
      'unfinished',
    );
  });
  await f.runs.create('completed', f.started);
  await f.runs.saveTransition(
    'completed',
    move(f.started, 'FINISH', 101000),
    101000,
    f.started.revision,
  );
  await f.settings.setBackgroundTrackingEnabled(true);
  expect(await f.recovery.remove('unfinished')).toBe(true);
  expect(await f.locations.listForRun('unfinished')).toEqual([]);
  expect((await f.runs.listCompleted()).map((r) => r.id)).toEqual(['completed']);
  expect(await f.settings.get()).toEqual({ backgroundTrackingEnabled: true });
  expect(await f.db.read((sql) => sql.getFirstAsync('PRAGMA user_version'))).toEqual({
    user_version: 1,
  });
  expect(await f.recovery.remove('unfinished')).toBe(true);
});
it('복구 삭제 DB 실패는 기록을 보존하고 재시도한다', async () => {
  const f = await fixture();
  await f.create();
  await f.db.write((sql) =>
    sql.execAsync(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'disk-full'); END;",
    ),
  );
  await expect(f.recovery.remove('unfinished')).rejects.toThrow();
  expect((await f.runs.findById('unfinished'))?.status).toBe('running');
  await f.db.write((sql) => sql.execAsync('DROP TRIGGER fail_delete'));
  expect(await f.recovery.remove('unfinished')).toBe(true);
});
it('동시에 누른 저장·삭제 중 하나만 실행한다', async () => {
  const f = await fixture();
  await f.create();
  const [saved, deleted] = await Promise.all([
    f.recovery.save('unfinished'),
    f.recovery.remove('unfinished'),
  ]);
  expect(saved?.status).toBe('completed');
  expect(deleted).toBe(false);
  expect(await f.runs.listCompleted()).toHaveLength(1);
});
it.each(['save', 'remove'] as const)(
  '복구 %s 뒤 늦은 위치 Task는 기록을 변경·재생성하지 않는다',
  async (action) => {
    const f = await fixture();
    await f.create();
    await f.recovery[action]('unfinished');
    const engine = createBackgroundGps(
      { runs: f.runs, locations: f.locations, getSession: f.getSession, snapshot: f.snapshot },
      PROPOSED_GPS_POLICY,
    );
    expect(
      await engine.processBatch([
        { latitude: 0, longitude: 0, accuracyMeters: 5, timestampMs: 900000 },
      ]),
    ).toEqual({ accepted: 0, rejected: 1 });
    expect(await f.locations.listForRun('unfinished')).toEqual([]);
    expect((await f.runs.findById('unfinished'))?.activeDurationMs ?? 0).toBe(
      action === 'save' ? 5000 : 0,
    );
  },
);
it('완료된 기록은 복구 삭제 경로에서 삭제하지 않는다', async () => {
  const f = await fixture();
  await f.create();
  await f.recovery.save('unfinished');
  await expect(f.recovery.remove('unfinished')).rejects.toThrow('이미 완료된');
  expect(await f.runs.listCompleted()).toHaveLength(1);
});

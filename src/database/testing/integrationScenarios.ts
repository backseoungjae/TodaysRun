// Node와 Android가 동일한 실제 SQL 시나리오를 실행한다.
import { createRunSession, transitionRunSession } from '@/features/run/domain/runSession';
import { acceptGpsFix } from '@/features/run/domain/gpsTracking';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';
import type { RunEvent, RunSession } from '@/features/run/domain/runTypes';
import type { DatabaseClient } from '../databaseClient';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { createAppSettingsRepository } from '../repositories/appSettingsRepository';

type Context = { db: DatabaseClient; reopen(): Promise<void> };
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
async function fails(operation: () => Promise<unknown>): Promise<void> {
  let failed = false;
  try {
    await operation();
  } catch {
    failed = true;
  }
  if (!failed) throw new Error('expected-operation-to-fail');
}
function move(session: RunSession, type: RunEvent['type'], atMs: number): RunSession {
  const result = transitionRunSession(session, { type, atMs, expectedRevision: session.revision });
  if (!result.accepted) throw new Error(result.reason);
  return result.session;
}
function start(atMs = 1000): RunSession {
  return move(move(createRunSession(), 'BEGIN_COUNTDOWN', 0), 'START', atMs);
}
function fix(session: RunSession, atMs: number, longitude = 0) {
  const result = acceptGpsFix(
    session,
    { latitude: 0, longitude, accuracyMeters: 5, timestampMs: atMs },
    atMs,
    PROPOSED_GPS_POLICY,
  );
  if (!result.accepted) throw new Error(result.reason);
  return result;
}
function repos(db: DatabaseClient) {
  return {
    runs: createRunRepository(db),
    locations: createRunLocationRepository(db),
    settings: createAppSettingsRepository(db),
  };
}

export const integrationCases: { name: string; run(context: Context): Promise<void> }[] = [
  {
    name: '초기화·Migration 001·WAL·외래 키',
    async run({ db }) {
      equal(await db.read((sql) => sql.getFirstAsync('PRAGMA user_version')), { user_version: 1 });
      equal(await db.read((sql) => sql.getFirstAsync('PRAGMA foreign_keys')), { foreign_keys: 1 });
      equal(await db.read((sql) => sql.getFirstAsync('PRAGMA journal_mode')), {
        journal_mode: 'wal',
      });
      const tables = await db.read((sql) =>
        sql.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
      );
      equal(tables, [{ name: 'app_settings' }, { name: 'run_locations' }, { name: 'runs' }]);
    },
  },
  {
    name: '중복 초기화와 재연결 시 데이터·설정 유지',
    async run(ctx) {
      const { runs, settings } = repos(ctx.db);
      const row = await runs.create("test-'quoted", start());
      await settings.setBackgroundTrackingEnabled(true);
      await Promise.all([ctx.db.initialize(), ctx.db.initialize()]);
      equal(await runs.findById(row.id), row);
      await ctx.reopen();
      equal(await repos(ctx.db).runs.findById(row.id), row);
      equal(await repos(ctx.db).settings.get(), { backgroundTrackingEnabled: true });
    },
  },
  {
    name: '러닝 생성·조회·Domain 시작 상태 제한',
    async run({ db }) {
      const { runs } = repos(db);
      await fails(() => runs.create('ready', createRunSession()));
      const row = await runs.create('run', start());
      equal(row.status, 'running');
      equal(row.activeSinceMs, 1000);
      equal(row.activeDurationMs, 0);
      equal(await runs.findById('run'), row);
      equal(await runs.findById('missing'), null);
      await fails(() => runs.create('run', start()));
    },
  },
  {
    name: 'GPS 좌표와 거리의 원자적 저장·순서·구간 유지',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const first = fix(session, 2000);
      await locations.append('run', first);
      const second = fix(first.session, 3000, 0.00005);
      await locations.append('run', second);
      const row = await runs.findById('run');
      if (!row || Math.abs(row.distanceMeters - 5.5597) > 0.001) throw new Error('wrong-distance');
      const points = await locations.listForRun('run');
      equal(
        points.map((p) => p.recordedAtMs),
        [2000, 3000],
      );
      equal(
        points.map((p) => p.segmentIndex),
        [0, 0],
      );
      equal(row.stateRevision, session.revision);
    },
  },
  {
    name: '좌표 INSERT 후 거리 UPDATE 실패 시 전체 Rollback',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const first = fix(session, 2000);
      await locations.append('run', first);
      await db.write((txn) =>
        txn.execAsync(`CREATE TRIGGER injected_failure BEFORE UPDATE OF distance_meters ON runs
      WHEN NEW.distance_meters > OLD.distance_meters BEGIN SELECT RAISE(ABORT,'injected-update-failure'); END;`),
      );
      const second = fix(first.session, 3000, 0.00005);
      await fails(() => locations.append('run', second));
      equal((await locations.listForRun('run')).length, 1);
      equal((await runs.findById('run'))?.distanceMeters, 0);
      await db.write((txn) => txn.execAsync('DROP TRIGGER injected_failure'));
      await locations.append('run', second);
      equal((await locations.listForRun('run')).length, 2);
    },
  },
  {
    name: '중복 GPS와 충돌하는 동일 시각 이벤트 차단',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const point = fix(session, 2000);
      const result = await Promise.all([
        locations.append('run', point),
        locations.append('run', point),
      ]);
      equal(result, [{ inserted: true }, { inserted: false }]);
      equal((await locations.listForRun('run')).length, 1);
      await fails(() =>
        locations.append('run', { ...point, point: { ...point.point, latitude: 1 } }),
      );
      equal((await runs.findById('run'))?.distanceMeters, 0);
    },
  },
  {
    name: 'Pause/Resume·시간 체크포인트·경로 분리',
    async run({ db }) {
      const { runs, locations } = repos(db);
      let session = start();
      await runs.create('run', session);
      const first = fix(session, 2000);
      await locations.append('run', first);
      session = first.session;
      const checkpoint = await runs.saveCheckpoint('run', session, 6000);
      equal(checkpoint.activeDurationMs, 5000);
      equal(checkpoint.committedDurationMs, 0);
      equal(checkpoint.activeSinceMs, 1000);
      const paused = move(session, 'PAUSE', 7000);
      const savedPause = await runs.saveTransition('run', paused, 7000, session.revision);
      equal(savedPause.activeDurationMs, 6000);
      equal(savedPause.activeSinceMs, null);
      await fails(() => locations.append('run', fix(session, 8000, 0.00005)));
      const resumed = move(paused, 'RESUME', 12_000);
      await runs.saveTransition('run', resumed, 12_000, paused.revision);
      const next = fix(resumed, 13_000, 1);
      await locations.append('run', next);
      equal(
        (await locations.listForRun('run')).map((p) => p.segmentIndex),
        [0, 1],
      );
      equal((await runs.saveCheckpoint('run', next.session, 14_000)).activeDurationMs, 8000);
      await fails(() => runs.saveCheckpoint('run', session, 15_000));
    },
  },
  {
    name: '정상 종료·재조회·중복 종료와 종료 후 GPS 차단',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const ended = move(session, 'FINISH', 6000);
      const saved = await runs.saveTransition('run', ended, 6000, session.revision);
      equal(saved.status, 'completed');
      equal(saved.activeDurationMs, 5000);
      equal(saved.completionReason, 'normal');
      equal(saved.endedAtMs, 6000);
      equal(await runs.findById('run'), saved);
      await fails(() => runs.saveTransition('run', ended, 6000, session.revision));
      await fails(() => locations.append('run', fix(session, 7000)));
    },
  },
  {
    name: '완료 목록 최신순 정렬',
    async run({ db }) {
      const { runs } = repos(db);
      for (const [id, at] of [
        ['older', 1000],
        ['newer', 2000],
      ] as const) {
        const session = start(at);
        await runs.create(id, session);
        await runs.saveTransition(
          id,
          move(session, 'FINISH', at + 1000),
          at + 1000,
          session.revision,
        );
      }
      equal(
        (await runs.listCompleted()).map((r) => r.id),
        ['newer', 'older'],
      );
    },
  },
  {
    name: '재연결 후 미완료 복구·마지막 저장값 보존·멱등성',
    async run(ctx) {
      const { runs, locations } = repos(ctx.db);
      const session = start();
      await runs.create('run', session);
      const point = fix(session, 2000);
      await locations.append('run', point);
      await runs.saveCheckpoint('run', point.session, 6000);
      const later = fix(point.session, 7000);
      await locations.append('run', later);
      await ctx.reopen();
      const reopened = repos(ctx.db);
      const unfinished = await reopened.runs.findUnfinished();
      equal(unfinished.length, 1);
      equal(unfinished[0].activeDurationMs, 5000);
      const saved = await reopened.runs.recover('run', session.revision);
      equal(saved.activeDurationMs, 5000);
      equal(saved.endedAtMs, 7000);
      equal(saved.completionReason, 'recovered');
      equal(await reopened.runs.recover('run', session.revision), saved);
      equal((await reopened.runs.findUnfinished()).length, 0);
      equal((await reopened.locations.listForRun('run')).length, 2);
      await fails(() => reopened.locations.append('run', fix(later.session, 8000)));
    },
  },
  {
    name: 'PAUSED 미완료 복구 시 정지 시간 보존',
    async run(ctx) {
      const { runs } = repos(ctx.db);
      const session = start();
      await runs.create('run', session);
      const paused = move(session, 'PAUSE', 6000);
      await runs.saveTransition('run', paused, 6000, session.revision);
      await ctx.reopen();
      const recovered = await repos(ctx.db).runs.recover('run', paused.revision);
      equal(recovered.activeDurationMs, 5000);
      equal(recovered.endedAtMs, 6000);
    },
  },
  {
    name: '개별 삭제 Cascade와 삭제 이후 늦은 GPS 차단',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const point = fix(session, 2000);
      await locations.append('run', point);
      await runs.deleteById('run');
      equal(await runs.findById('run'), null);
      equal(await locations.listForRun('run'), []);
      await fails(() => locations.append('run', point));
      equal(await runs.findById('run'), null);
    },
  },
  {
    name: '전체 삭제 후 설정·테이블·Migration 버전 유지',
    async run(ctx) {
      const { runs, locations, settings } = repos(ctx.db);
      const session = start();
      await runs.create('run', session);
      await locations.append('run', fix(session, 2000));
      await settings.setBackgroundTrackingEnabled(true);
      await runs.deleteAll();
      equal(await runs.findUnfinished(), []);
      equal(await runs.listCompleted(), []);
      equal(await locations.listForRun('run'), []);
      await ctx.reopen();
      equal(await repos(ctx.db).settings.get(), { backgroundTrackingEnabled: true });
      equal(await ctx.db.read((sql) => sql.getFirstAsync('PRAGMA user_version')), {
        user_version: 1,
      });
    },
  },
  {
    name: '외래 키·좌표·상태·설정 CHECK와 UNIQUE 제약',
    async run({ db }) {
      const { runs } = repos(db);
      await runs.create('run', start());
      await fails(() =>
        db.write(async (txn) => {
          await txn.runAsync(
            'INSERT INTO run_locations(run_id,latitude,longitude,accuracy_meters,recorded_at_ms,segment_index,distance_delta_meters) VALUES(?,0,0,5,2000,0,0)',
            'missing',
          );
        }),
      );
      await fails(() =>
        db.write(async (txn) => {
          await txn.runAsync(
            'INSERT INTO run_locations(run_id,latitude,longitude,accuracy_meters,recorded_at_ms,segment_index,distance_delta_meters) VALUES(?,91,0,5,2000,0,0)',
            'run',
          );
        }),
      );
      await fails(() =>
        db.write(async (txn) => {
          await txn.runAsync("UPDATE runs SET status='ready' WHERE id=?", 'run');
        }),
      );
      await fails(() =>
        db.write(async (txn) => {
          await txn.runAsync('UPDATE app_settings SET background_tracking_enabled=2 WHERE id=1');
        }),
      );
      await fails(() =>
        db.write(async (txn) => {
          await txn.runAsync('UPDATE runs SET active_duration_ms=-1 WHERE id=?', 'run');
        }),
      );
      const insert = async () =>
        db.write(async (txn) => {
          await txn.runAsync(
            'INSERT INTO run_locations(run_id,latitude,longitude,accuracy_meters,recorded_at_ms,segment_index,distance_delta_meters) VALUES(?,0,0,5,2000,0,0)',
            'run',
          );
        });
      await insert();
      await fails(insert);
      equal(await db.read((sql) => sql.getAllAsync('PRAGMA foreign_key_check')), []);
    },
  },
  {
    name: 'FIFO 쓰기 순서와 실패 후 큐 복구',
    async run({ db }) {
      const { runs, locations } = repos(db);
      const session = start();
      await runs.create('run', session);
      const first = fix(session, 2000);
      const ended = move(first.session, 'FINISH', 3000);
      await Promise.all([
        locations.append('run', first),
        runs.saveTransition('run', ended, 3000, session.revision),
        runs.deleteById('run'),
      ]);
      equal(await runs.findById('run'), null);
      equal(await locations.listForRun('run'), []);
      await fails(() => locations.append('run', first));
      await runs.create('other', start());
      equal((await runs.findUnfinished()).length, 1);
    },
  },
];

export async function executeIntegrationCase(
  testCase: (typeof integrationCases)[number],
  open: (name: string) => Promise<DatabaseClient>,
  name: string,
): Promise<void> {
  const ctx: Context = {
    db: await open(name),
    async reopen() {
      await ctx.db.close();
      ctx.db = await open(name);
    },
  };
  try {
    await testCase.run(ctx);
  } finally {
    await ctx.db.close();
  }
}

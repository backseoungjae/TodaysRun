import { getDatabase } from '../database';
import { getCompletedRun, getRunPath } from '@/features/run/services/runResultService';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDatabase } from './nodeSqlite';
import { createRunRepository } from '../repositories/runRepository';
import { createRunLocationRepository } from '../repositories/runLocationRepository';
import { createAppSettingsRepository } from '../repositories/appSettingsRepository';
import { createRunSession, transitionRunSession } from '@/features/run/domain/runSession';
import type { RunSession, RunEvent } from '@/features/run/domain/runTypes';
import { acceptGpsFix } from '@/features/run/domain/gpsTracking';
import { PROPOSED_GPS_POLICY } from '@/features/run/domain/gpsPolicy';

jest.mock('../database', () => ({ getDatabase: jest.fn() }));

function move(session: RunSession, type: RunEvent['type'], atMs: number) {
  const result = transitionRunSession(session, { type, atMs, expectedRevision: session.revision });
  if (!result.accepted) throw new Error(result.reason);
  return result.session;
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todaysrun-history-'));
  const db = await openNodeDatabase(join(dir, 'history.db'));
  const runs = createRunRepository(db),
    locations = createRunLocationRepository(db),
    settings = createAppSettingsRepository(db);
  const f = {
    db,
    runs,
    locations,
    settings,
    async create(id: string, at = 1000, completed = true, withPoint = true) {
      let session = move(move(createRunSession(), 'BEGIN_COUNTDOWN', at - 1), 'START', at);
      await runs.create(id, session);
      if (withPoint) {
        const gps = acceptGpsFix(
          session,
          { latitude: 0, longitude: 0, accuracyMeters: 5, timestampMs: at + 1 },
          at + 1,
          PROPOSED_GPS_POLICY,
        );
        if (!gps.accepted) throw new Error(gps.reason);
        await locations.append(id, gps);
        session = gps.session;
      }
      if (completed) {
        const done = move(session, 'FINISH', at + 2);
        await runs.saveTransition(id, done, at + 2, session.revision);
      }
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
it('0km·2ms 기록을 정상 완료·저장·조회하고 최신순 completed만 반환한다', async () => {
  const f = await fixture();
  await f.create('older');
  await f.create('newer', 2000, true, false);
  await f.create('active', 3000, false);
  const values = await f.runs.listCompleted();
  expect(values.map((r) => r.id)).toEqual(['newer', 'older']);
  expect(values[0]).toMatchObject({
    distanceMeters: 0,
    activeDurationMs: 2,
    completionReason: 'normal',
  });
  expect(await f.locations.listForRun('newer')).toEqual([]);
});
it('완료 기록 삭제는 좌표 Cascade를 적용하고 활성 기록 삭제는 차단한다', async () => {
  const f = await fixture();
  await f.create('zero');
  await f.create('active', 2000, false);
  await expect(f.runs.deleteById('active', true)).rejects.toThrow();
  expect(await f.runs.findById('active')).not.toBeNull();
  await f.runs.deleteById('zero', true);
  expect(await f.runs.findById('zero')).toBeNull();
  expect(await f.locations.listForRun('zero')).toEqual([]);
  await expect(f.runs.deleteById('zero', true)).rejects.toThrow();
});
it('미완료 기록이 있으면 전체 삭제 Transaction을 실행하지 않는다', async () => {
  const f = await fixture();
  await f.create('done');
  await f.create('active', 2000, false);
  await expect(f.runs.deleteAll(true)).rejects.toThrow(/미완료/);
  expect(await f.runs.findById('done')).not.toBeNull();
  expect(await f.locations.listForRun('done')).toHaveLength(1);
});
it('전체 삭제 후 설정·테이블·스키마 버전과 FK가 유지된다', async () => {
  const f = await fixture();
  await f.create('one');
  await f.create('two', 2000);
  await f.settings.setBackgroundTrackingEnabled(true);
  await f.runs.deleteAll(true);
  expect(await f.runs.listCompleted()).toEqual([]);
  expect(await f.locations.listForRun('one')).toEqual([]);
  expect(await f.settings.get()).toEqual({ backgroundTrackingEnabled: true });
  expect(await f.db.read((sql) => sql.getFirstAsync('PRAGMA user_version'))).toEqual({
    user_version: 1,
  });
  expect(await f.db.read((sql) => sql.getAllAsync('PRAGMA foreign_key_check'))).toEqual([]);
});
it('실제 SQLite 삭제 중 실패하면 기록·좌표를 함께 롤백한다', async () => {
  const f = await fixture();
  await f.create('one');
  await f.db.write((sql) =>
    sql.execAsync(
      "CREATE TRIGGER fail_delete AFTER DELETE ON runs BEGIN SELECT RAISE(ABORT, 'simulated'); END;",
    ),
  );
  await expect(f.runs.deleteById('one', true)).rejects.toThrow();
  expect(await f.runs.findById('one')).not.toBeNull();
  expect(await f.locations.listForRun('one')).toHaveLength(1);
});

it('결과 Service는 실제 저장된 다중 구간 좌표를 변환하고 없는 기록을 거절한다', async () => {
  const f = await fixture();
  jest.mocked(getDatabase).mockResolvedValue(f.db);
  let session = move(move(createRunSession(), 'BEGIN_COUNTDOWN', 999), 'START', 1000);
  await f.runs.create('path', session);
  const add = async (atMs: number, longitude: number) => {
    const gps = acceptGpsFix(
      session,
      { latitude: 0, longitude, accuracyMeters: 5, timestampMs: atMs },
      atMs,
      PROPOSED_GPS_POLICY,
    );
    if (!gps.accepted) throw new Error(gps.reason);
    await f.locations.append('path', gps);
    session = gps.session;
  };
  await add(1001, 0);
  await add(1200, 0.00001);
  const pause = move(session, 'PAUSE', 2000);
  await f.runs.saveTransition('path', pause, 2000, session.revision);
  session = pause;
  const resume = move(session, 'RESUME', 5000);
  await f.runs.saveTransition('path', resume, 5000, session.revision);
  session = resume;
  await add(5001, 0.001);
  await add(5200, 0.00101);
  const done = move(session, 'FINISH', 6000);
  await f.runs.saveTransition('path', done, 6000, session.revision);
  expect((await getCompletedRun('path')).activeDurationMs).toBe(2000);
  expect((await getRunPath('path')).map((point) => point.segmentId)).toEqual([0, 0, 1, 1]);
  await expect(getCompletedRun('missing')).rejects.toThrow();
});

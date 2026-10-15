import type { createRunRepository } from '@/database/repositories/runRepository';
import type { createRunLocationRepository } from '@/database/repositories/runLocationRepository';
import { acceptGpsFix } from '../domain/gpsTracking';
import { calculateAveragePaceSecondsPerKm } from '../domain/runMetrics';
import { createRunSession, getElapsedMs, transitionRunSession } from '../domain/runSession';
import type { GpsFix, GpsPolicy, RunSession } from '../domain/runTypes';
import type { createRunStore } from '../store/runStore';
import type { RunLocationRecord } from '@/database/databaseTypes';
import type { LocationAdapter } from './preparationTypes';
import { isReadyLocation } from './locationReadiness';

type Dependencies = {
  runs: ReturnType<typeof createRunRepository>;
  locations: ReturnType<typeof createRunLocationRepository>;
  store: ReturnType<typeof createRunStore>;
  location: Pick<LocationAdapter, 'watch'>;
  canStart(): Promise<boolean>;
  now(): number;
  makeId(): string;
  navigateRunning(): Promise<void>;
  background?: {
    start(id: string): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
    committed?(): void;
    reload(
      id: string,
    ): Promise<{ session: RunSession; path: RunLocationRecord[]; error: string | null }>;
    checkpoint(id: string): Promise<void>;
  };
};

export function createRunService(deps: Dependencies, policy: GpsPolicy) {
  let session: RunSession | null = null;
  let id: string | null = null;
  let tail = Promise.resolve();
  let controlBusy = false;
  let generation = 0;
  let subscription: { remove(): void } | null = null;
  let displayTimer: ReturnType<typeof setInterval> | null = null;
  let checkpointTimer: ReturnType<typeof setInterval> | null = null;
  let foreground = true;
  let pendingCheckpoint = false;
  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const showError = (message: string) => deps.store.setState({ error: message });
  const stopLocation = () => {
    generation++;
    subscription?.remove();
    subscription = null;
  };
  let refreshing = false;
  async function refreshSession() {
    if (!deps.background || !id) return;
    const saved = await deps.background.reload(id);
    session = saved.session;
    const last = saved.path.at(-1);
    deps.store.setState((state) => ({
      path:
        state.path.length === saved.path.length &&
        state.path.at(-1)?.timestampMs === last?.recordedAtMs
          ? state.path
          : saved.path.map((point) => ({
              latitude: point.latitude,
              longitude: point.longitude,
              timestampMs: point.recordedAtMs,
              segmentId: point.segmentIndex,
            })),
      current: last
        ? state.current?.timestampMs === last.recordedAtMs
          ? state.current
          : {
              latitude: last.latitude,
              longitude: last.longitude,
              accuracyMeters: last.accuracyMeters,
              timestampMs: last.recordedAtMs,
            }
        : state.current,
    }));
    const previousError = deps.store.getState().error;
    publish(false);
    if (!saved.error && previousError === '위치 저장에 실패했어요. 다음 위치에서 재시도해요.')
      deps.store.setState({ error: null });
    if (saved.error) showError(saved.error);
  }
  function publish(clearError = true) {
    if (!session || !id) return;
    const durationMs = getElapsedMs(session, deps.now()) ?? session.elapsedMs;
    deps.store.setState({
      id,
      status:
        session.status === 'RUNNING' ||
        session.status === 'PAUSED' ||
        session.status === 'COMPLETED'
          ? session.status
          : null,
      durationMs,
      distanceMeters: session.gps.distanceMeters,
      pace: calculateAveragePaceSecondsPerKm(durationMs, session.gps.distanceMeters),
      ...(clearError ? { error: null } : {}),
    });
  }
  const clearTimers = () => {
    if (displayTimer !== null) clearInterval(displayTimer);
    if (checkpointTimer !== null) clearInterval(checkpointTimer);
    displayTimer = checkpointTimer = null;
  };
  async function append(fix: GpsFix, token: number) {
    if (token !== generation || !foreground || session?.status !== 'RUNNING' || !id) return;
    const accepted = acceptGpsFix(session, fix, deps.now(), policy);
    if (!accepted.accepted) return;
    await deps.locations.append(id, accepted);
    // 진행 중 Transaction은 취소하지 않는다. Commit된 Domain을 다음 전이에 반드시 반영한다.
    session = accepted.session;
    deps.store.setState((state) => ({
      current: { ...fix },
      path: state.path.some((point) => point.timestampMs === fix.timestampMs)
        ? state.path
        : [...state.path, { ...fix, segmentId: accepted.point.segmentId }],
    }));
    publish();
  }
  async function watch() {
    if (!foreground || session?.status !== 'RUNNING') return;
    if (deps.background && id) {
      await deps.background.start(id);
      return;
    }
    const token = ++generation;
    const handle = await deps.location.watch(
      (fix) => {
        void queue(() => append(fix, token)).catch(() =>
          showError('위치 저장에 실패했어요. 다음 위치에서 다시 시도해요.'),
        );
      },
      () => {
        if (token === generation) {
          stopLocation();
          showError('위치 수신이 중단됐어요. 일시정지 후 재개해 주세요.');
        }
      },
    );
    if (token !== generation || !foreground || session?.status !== 'RUNNING') handle.remove();
    else subscription = handle;
  }
  function startTimers() {
    clearTimers();
    displayTimer = setInterval(() => {
      if (deps.background && foreground && !refreshing && !controlBusy) {
        refreshing = true;
        void queue(refreshSession)
          .catch(() => showError('저장된 러닝 상태를 읽지 못했어요.'))
          .finally(() => {
            refreshing = false;
          });
        return;
      }
      if (session?.status !== 'RUNNING') return;
      const durationMs = getElapsedMs(session, deps.now());
      if (durationMs !== null)
        deps.store.setState({
          durationMs,
          pace: calculateAveragePaceSecondsPerKm(durationMs, session.gps.distanceMeters),
        });
    }, 1_000);
    checkpointTimer = setInterval(() => {
      void checkpoint().catch(() => {});
    }, 5_000);
  }
  async function checkpoint() {
    if (pendingCheckpoint || controlBusy || session?.status !== 'RUNNING') return;
    pendingCheckpoint = true;
    try {
      await queue(async () => {
        if (!id || session?.status !== 'RUNNING') return;
        if (deps.background) await deps.background.checkpoint(id);
        else await deps.runs.saveCheckpoint(id, session, deps.now());
      });
    } catch (error) {
      showError('운동 시간 저장에 실패했어요. 다음 체크포인트에서 다시 시도해요.');
      throw error;
    } finally {
      pendingCheckpoint = false;
    }
  }
  async function change(type: 'PAUSE' | 'RESUME' | 'FINISH') {
    if (controlBusy) return null;
    if (
      !id ||
      !session ||
      (type === 'PAUSE' ? session.status !== 'RUNNING' : session.status !== 'PAUSED')
    )
      return null;
    controlBusy = true;
    deps.store.setState({ busy: true });
    stopLocation();
    try {
      return await queue(async () => {
        if (!id || !session) throw new Error('no-active-run');
        if (deps.background) {
          await deps.background.stop();
          await refreshSession();
        }
        if (type === 'RESUME' && (!(await deps.canStart()) || !foreground))
          throw new Error('시작 조건을 다시 확인해 주세요.');
        const atMs = deps.now();
        const next = transitionRunSession(session, {
          type,
          atMs,
          expectedRevision: session.revision,
        });
        if (!next.accepted) throw new Error('invalid-transition');
        await deps.runs.saveTransition(id, next.session, atMs, session.revision);
        session = next.session;
        publish();
        if (type === 'RESUME') {
          try {
            await watch();
          } catch (error) {
            const rollbackAt = deps.now();
            const paused = transitionRunSession(session, {
              type: 'PAUSE',
              atMs: rollbackAt,
              expectedRevision: session.revision,
            });
            if (paused.accepted) {
              await deps.runs.saveTransition(id, paused.session, rollbackAt, session.revision);
              session = paused.session;
              publish();
            }
            throw error;
          }
        }
        if (type === 'FINISH') {
          clearTimers();
          deps.background?.clear();
        }
        return id;
      });
    } catch (error) {
      showError('상태를 저장하거나 위치를 준비하지 못했어요. 다시 시도해 주세요.');
      if (!deps.background && session?.status === 'RUNNING' && foreground && subscription === null)
        await watch().catch(() =>
          showError('위치 수신이 중단됐어요. 일시정지를 다시 시도해 주세요.'),
        );
      throw error;
    } finally {
      controlBusy = false;
      deps.store.setState({ busy: false });
    }
  }
  return {
    hasActiveRun: () =>
      controlBusy || session?.status === 'RUNNING' || session?.status === 'PAUSED',
    async manageRecords<T>(operation: () => Promise<T>): Promise<T> {
      if (controlBusy || session?.status === 'RUNNING' || session?.status === 'PAUSED')
        throw new Error('러닝이 진행 중일 때는 기록을 삭제할 수 없어요.');
      controlBusy = true;
      deps.store.setState({ busy: true });
      try {
        return await queue(operation);
      } finally {
        controlBusy = false;
        deps.store.setState({ busy: false });
      }
    },
    async start(prepared: GpsFix, signal: AbortSignal) {
      if (controlBusy) return;
      controlBusy = true;
      deps.store.setState({ busy: true });
      try {
        await queue(async () => {
          if (session && session.status !== 'COMPLETED')
            throw new Error('이미 진행 중인 러닝이 있어요.');
          if ((await deps.runs.findUnfinished()).length)
            throw new Error(
              '미완료 기록이 있어 새 러닝을 시작할 수 없어요. 먼저 이전 기록을 복구해 주세요.',
            );
          if (
            signal.aborted ||
            !foreground ||
            !(await deps.canStart()) ||
            !isReadyLocation(prepared, deps.now(), policy)
          )
            throw new Error('위치와 권한을 다시 준비해 주세요.');
          let next = createRunSession();
          for (const type of ['BEGIN_COUNTDOWN', 'START'] as const) {
            const result = transitionRunSession(next, {
              type,
              atMs: deps.now(),
              expectedRevision: next.revision,
            });
            if (!result.accepted) throw new Error('invalid-start');
            next = result.session;
          }
          const newId = deps.makeId();
          await deps.runs.create(newId, next);
          id = newId;
          session = next;
          try {
            if (signal.aborted || !foreground) throw new Error('시작이 취소됐어요.');
            await watch();
            if (signal.aborted || !foreground) throw new Error('시작이 취소됐어요.');
            deps.store.setState({ current: { ...prepared }, path: [] });
            publish();
            await deps.navigateRunning();
            deps.background?.committed?.();
            startTimers();
          } catch (error) {
            stopLocation();
            clearTimers();
            try {
              await deps.background?.stop();
              await deps.runs.deleteById(newId);
              deps.background?.clear();
            } catch {
              throw new Error(
                '시작 기록을 정리하지 못했어요. 미완료 기록을 보존하며 새 시작을 차단합니다.',
              );
            } finally {
              id = null;
              session = null;
              deps.store.setState({ id: null, status: null, current: null, path: [] });
            }
            throw error;
          }
        });
      } catch (error) {
        showError(error instanceof Error ? error.message : '러닝 시작에 실패했어요.');
        throw error;
      } finally {
        controlBusy = false;
        deps.store.setState({ busy: false });
      }
    },
    pause: () => change('PAUSE'),
    resume: () => change('RESUME'),
    finish: () => change('FINISH'),
    checkpoint,
    async discard(runId: string): Promise<void> {
      if (controlBusy) throw new Error('러닝 상태를 변경하고 있어요. 잠시 후 다시 시도해 주세요.');
      controlBusy = true;
      deps.store.setState({ busy: true });
      stopLocation();
      clearTimers();
      try {
        await queue(async () => {
          if (
            id !== runId ||
            !session ||
            (session.status !== 'RUNNING' && session.status !== 'PAUSED')
          )
            throw new Error('삭제할 진행 중인 러닝을 다시 확인해 주세요.');
          if (deps.background) {
            await deps.background.stop();
            await refreshSession();
          }
          if (!session) throw new Error('삭제할 러닝이 없어요.');
          await deps.runs.deleteById(runId, false, session.revision);
          id = null;
          session = null;
          deps.store.setState({
            id: null,
            status: null,
            durationMs: 0,
            distanceMeters: 0,
            pace: null,
            current: null,
            path: [],
            error: null,
          });
          deps.background?.clear();
        });
      } catch (error) {
        if (session) startTimers();
        showError('기록을 삭제하지 못했어요. 기존 기록을 보존하며 다시 시도해 주세요.');
        throw error;
      } finally {
        controlBusy = false;
        deps.store.setState({ busy: false });
      }
    },
    async setForeground(enabled: boolean) {
      foreground = enabled;
      if (deps.background) {
        if (enabled && (session?.status === 'RUNNING' || session?.status === 'PAUSED'))
          await queue(refreshSession).catch(() => showError('러닝 상태를 복원하지 못했어요.'));
        return;
      }
      stopLocation();
      await queue(async () => {
        if (!session || session.status !== 'RUNNING') return;
        // 화면 밖에서 수집하지 않은 구간을 직선으로 연결하지 않는다.
        session = { ...session, gps: { ...session.gps, anchor: null } };
        if (enabled && !controlBusy) await watch();
      }).catch(() => showError('위치 재연결에 실패했어요. 일시정지 후 재개해 주세요.'));
    },
    async attach(runId: string) {
      if (!deps.background || session || controlBusy) return;
      controlBusy = true;
      deps.store.setState({ busy: true });
      try {
        await queue(async () => {
          deps.store.setState({ error: null });
          id = runId;
          await refreshSession();
          startTimers();
        });
      } finally {
        controlBusy = false;
        deps.store.setState({ busy: false });
      }
    },
    dispose() {
      stopLocation();
      clearTimers();
    },
    drain: () => tail,
  };
}

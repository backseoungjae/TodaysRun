import type { GpsFix, GpsPolicy } from '../domain/runTypes';
import { isReadyLocation } from './locationReadiness';
import type { PreparationDependencies, PreparationState, PermissionKind } from './preparationTypes';

export const INITIAL_LOCATION_TIMEOUT_MS = 15_000;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('cancelled'));
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createRunPreparation(
  deps: PreparationDependencies,
  policy: GpsPolicy,
  onState: (state: PreparationState) => void,
  timeoutMs = INITIAL_LOCATION_TIMEOUT_MS,
) {
  let active: AbortController | null = null;
  let state: PreparationState = { status: 'idle' };
  const update = (next: PreparationState) => {
    state = next;
    onState(next);
  };

  async function ensurePermission(kind: PermissionKind, signal: AbortSignal) {
    let permission = await abortable(deps.location.getPermission(kind), signal);
    if (permission.granted) return;
    if (!(await abortable(deps.confirm(kind, !permission.canAskAgain, signal), signal)))
      throw new Error('permission-cancelled');
    if (permission.canAskAgain)
      await abortable(deps.location.requestPermission(kind, signal), signal);
    else await abortable(deps.location.openSettings(signal), signal);
    // OS 요청 반환값 대신 설정 복귀 후 실제 권한을 새로 조회한다.
    permission = await abortable(deps.location.getPermission(kind), signal);
    if (!permission.granted)
      throw new Error(`${kind}-${permission.canAskAgain ? 'denied' : 'blocked'}`);
  }

  async function checkRequirements(signal: AbortSignal) {
    if (deps.isAppActive && !deps.isAppActive()) throw new Error('app-inactive');
    if (!(await abortable(deps.backgroundEnabled(), signal)))
      throw new Error('background-setting-off');
    const foreground = await abortable(deps.location.getPermission('foreground'), signal);
    const background = await abortable(deps.location.getPermission('background'), signal);
    if (!foreground.granted || !background.granted) throw new Error('permission-revoked');
    if (!(await abortable(deps.location.servicesEnabled(), signal)))
      throw new Error('services-off');
    if (deps.isAppActive && !deps.isAppActive()) throw new Error('app-inactive');
  }

  return {
    getState: () => state,
    cancel() {
      const previous = active;
      active = null;
      previous?.abort();
      update({ status: 'idle' });
    },
    async start(): Promise<void> {
      if (active) return;
      const controller = new AbortController();
      const { signal } = controller;
      active = controller;
      update({ status: 'checkingPermission' });
      let subscription: { remove(): void } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let monitor: ReturnType<typeof setInterval> | null = null;
      let latestFix: GpsFix | null = null;
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (monitor !== null) clearInterval(monitor);
        monitor = null;
        subscription?.remove();
        subscription = null;
      };
      signal.addEventListener('abort', cleanup, { once: true });
      try {
        if (!(await abortable(deps.backgroundEnabled(), signal)))
          throw new Error('background-setting-off');
        await ensurePermission('foreground', signal);
        await ensurePermission('background', signal);
        if (deps.prepareNotifications) await abortable(deps.prepareNotifications(signal), signal);
        await checkRequirements(signal);
        update({ status: 'waitingForLocation' });
        let monitoring = false;
        monitor = setInterval(() => {
          if (monitoring || signal.aborted) return;
          monitoring = true;
          void checkRequirements(signal)
            .catch((error: unknown) => {
              if (signal.aborted || active !== controller) return;
              controller.abort();
              update({
                status: 'failed',
                reason: error instanceof Error ? error.message : 'unknown',
              });
            })
            .finally(() => {
              monitoring = false;
            });
        }, 1_000);
        await abortable(
          new Promise<void>((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('location-timeout')), timeoutMs);
            void deps.location
              .watch(
                (fix) => {
                  if (signal.aborted || active !== controller) return;
                  if (
                    isReadyLocation(fix, deps.now(), policy) &&
                    (latestFix === null || fix.timestampMs > latestFix.timestampMs)
                  ) {
                    latestFix = { ...fix };
                    resolve();
                  }
                },
                () => {
                  if (signal.aborted || active !== controller) return;
                  controller.abort();
                  update({ status: 'failed', reason: 'location-error' });
                },
              )
              .then(
                (handle) => {
                  // 네이티브 구독 생성이 취소보다 늦게 끝나도 반드시 제거한다.
                  if (signal.aborted || active !== controller) handle.remove();
                  else subscription = handle;
                },
                () => reject(new Error('location-error')),
              );
          }),
          signal,
        );
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (monitor !== null) clearInterval(monitor);
        monitor = null;
        const deadline = deps.now() + 3_000;
        while (true) {
          await checkRequirements(signal);
          if (latestFix === null || !isReadyLocation(latestFix, deps.now(), policy))
            throw new Error('location-lost');
          const remaining = deadline - deps.now();
          if (remaining <= 0) break;
          update({ status: 'countdown', seconds: Math.ceil(remaining / 1_000) });
          await abortable(
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, Math.min(1_000, remaining));
            }),
            signal,
          );
        }
        cleanup();
        if (active === controller && !signal.aborted) {
          update({ status: 'starting' });
          await deps.onPrepared(latestFix, signal);
          if (active === controller && !signal.aborted) update({ status: 'idle' });
        }
      } catch (error) {
        if (active === controller && !signal.aborted)
          update({ status: 'failed', reason: error instanceof Error ? error.message : 'unknown' });
      } finally {
        controller.abort();
        signal.removeEventListener('abort', cleanup);
        cleanup();
        if (active === controller) active = null;
      }
    },
  };
}

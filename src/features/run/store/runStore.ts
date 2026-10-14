import { createStore } from 'zustand/vanilla';
import type { GpsFix } from '../domain/runTypes';
import type { PathPoint } from '../components/RunMap';

export type RunView = {
  id: string | null;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | null;
  durationMs: number;
  distanceMeters: number;
  pace: number | null;
  current: GpsFix | null;
  path: readonly PathPoint[];
  busy: boolean;
  error: string | null;
};
export function createRunStore() {
  return createStore<RunView>(() => ({
    id: null,
    status: null,
    durationMs: 0,
    distanceMeters: 0,
    pace: null,
    current: null,
    path: [],
    busy: false,
    error: null,
  }));
}
const storeGlobal = globalThis as typeof globalThis & {
  todaysRunStore?: ReturnType<typeof createRunStore>;
};
export const runStore = (storeGlobal.todaysRunStore ??= createRunStore());

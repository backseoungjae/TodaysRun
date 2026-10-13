import type { GpsFix } from '../domain/runTypes';

export type LocationPermission = { granted: boolean; canAskAgain: boolean };
export type PermissionKind = 'foreground' | 'background';
export type PreparationState =
  | { status: 'idle' }
  | { status: 'checkingPermission' }
  | { status: 'waitingForLocation' }
  | { status: 'countdown'; seconds: number }
  | { status: 'failed'; reason: string };

export interface LocationAdapter {
  getPermission(kind: PermissionKind): Promise<LocationPermission>;
  requestPermission(kind: PermissionKind, signal: AbortSignal): Promise<void>;
  openSettings(signal: AbortSignal): Promise<void>;
  servicesEnabled(): Promise<boolean>;
  watch(onFix: (fix: GpsFix) => void, onError: () => void): Promise<{ remove(): void }>;
}

export interface PreparationDependencies {
  location: LocationAdapter;
  backgroundEnabled(): Promise<boolean>;
  confirm(kind: PermissionKind, needsSettings: boolean, signal: AbortSignal): Promise<boolean>;
  onPrepared(fix: GpsFix): void;
  now(): number;
  isAppActive?(): boolean;
}

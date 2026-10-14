import * as Location from 'expo-location';
import { Alert, AppState, Linking, Platform } from 'react-native';
import type { LocationAdapter, PermissionKind } from './preparationTypes';

// OS 설정을 여는 Promise는 이동 시 끝날 수 있으므로 active 복귀까지 별도로 기다린다.
export function waitForSettingsReturn(open: () => Promise<unknown>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let left = AppState.currentState !== 'active';
    const cleanup = () => {
      listener.remove();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error('cancelled'));
    };
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') left = true;
      else if (left) {
        cleanup();
        resolve();
      }
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    void open().catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

export const locationAdapter: LocationAdapter = {
  getPermission(kind) {
    return kind === 'foreground'
      ? Location.getForegroundPermissionsAsync()
      : Location.getBackgroundPermissionsAsync();
  },
  async requestPermission(kind, signal) {
    if (kind === 'foreground') {
      await Location.requestForegroundPermissionsAsync();
    } else if (Platform.OS === 'android' && Number(Platform.Version) >= 30) {
      // Android 11+는 항상 허용을 런타임 다이얼로그에서 선택할 수 없다.
      await waitForSettingsReturn(() => Linking.openSettings(), signal);
    } else {
      await Location.requestBackgroundPermissionsAsync();
    }
  },
  openSettings(signal) {
    return waitForSettingsReturn(() => Linking.openSettings(), signal);
  },
  servicesEnabled: () => Location.hasServicesEnabledAsync(),
  watch(onFix, onError) {
    return Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1_000, distanceInterval: 0 },
      (value) =>
        onFix({
          latitude: value.coords.latitude,
          longitude: value.coords.longitude,
          accuracyMeters: value.coords.accuracy ?? Number.NaN,
          timestampMs: value.timestamp,
        }),
      () => onError(),
    );
  },
};

export function confirmLocationPermission(
  kind: PermissionKind,
  needsSettings: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => finish(false);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) return cancel();
    const message =
      kind === 'foreground'
        ? '현재 위치를 준비하려면 위치 권한이 필요해요.'
        : '화면을 끄거나 다른 앱을 볼 때도 러닝을 기록하려면 백그라운드 위치 권한이 필요해요. Android 11 이상에서는 설정의 위치 권한에서 “항상 허용”을 선택한 뒤 돌아와 주세요.';
    Alert.alert(
      '위치 권한 안내',
      needsSettings ? `${message}\n기기 설정에서 권한을 변경해 주세요.` : message,
      [
        { text: '취소', style: 'cancel', onPress: cancel },
        { text: needsSettings ? '설정 열기' : '확인', onPress: () => finish(!signal.aborted) },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  });
}

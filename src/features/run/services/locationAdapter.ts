import * as Location from 'expo-location';
import { Alert, AppState, Linking, Platform } from 'react-native';
import type { LocationAdapter } from './preparationTypes';

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

export function confirmLocationPermission(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => finish(false);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) return cancel();
    const message =
      (Platform.OS === 'android'
        ? '러닝을 시작하려면 위치 권한이 필요해요. “앱 사용 중에만 허용”으로 시작할 수 있어요. 러닝 중에는 위치 기록 알림과 함께 화면 잠금·앱 전환 중에도 기록해요.'
        : '러닝을 시작하려면 위치 권한과 백그라운드 위치 권한이 필요해요.') +
      '\n확인을 누르면 필요한 권한을 요청하고, 허용이 완료되면 백그라운드 기록 사용을 켜요. 권한을 다시 요청할 수 없으면 기기 설정에서 허용한 뒤 돌아와 주세요.';
    Alert.alert(
      '위치 권한 안내',
      message,
      [
        { text: '취소', style: 'cancel', onPress: cancel },
        { text: '확인', onPress: () => finish(!signal.aborted) },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  });
}

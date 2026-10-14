import { PermissionsAndroid, Platform } from 'react-native';

export async function prepareRunNotifications(signal: AbortSignal): Promise<void> {
  if (signal.aborted || Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  if (signal.aborted) return;
  // 권한 거절은 OS에서 알림 노출을 제한한다. FGS 실행 권한으로 임의 해석하지 않는다.
  await PermissionsAndroid.request(permission, {
    title: '러닝 기록 알림',
    message: '앱을 전환하거나 화면을 잠가도 러닝 기록 중임을 알림에서 확인할 수 있어요.',
    buttonPositive: '계속',
    buttonNegative: '취소',
  });
}

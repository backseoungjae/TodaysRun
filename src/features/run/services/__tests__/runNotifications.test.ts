import { PermissionsAndroid, Platform } from 'react-native';
import { prepareRunNotifications } from '../runNotifications';
const originalOS = Platform.OS,
  originalVersion = Platform.Version;
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  jest.restoreAllMocks();
});
it('API 33 이상에서 OS 알림 권한을 실제 조회한 뒤 요청한다', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  const request = jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  await prepareRunNotifications(new AbortController().signal);
  expect(request).toHaveBeenCalledWith(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    expect.objectContaining({ title: '러닝 기록 알림' }),
  );
});
it('거절을 허용 상태로 바꾸거나 러닝 시작의 필수 조건으로 만들지 않는다', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
  await expect(prepareRunNotifications(new AbortController().signal)).resolves.toBeUndefined();
});
it('이미 허용되어 있으면 중복 요청하지 않는다', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  const request = jest.spyOn(PermissionsAndroid, 'request');
  await prepareRunNotifications(new AbortController().signal);
  expect(request).not.toHaveBeenCalled();
});
it('Android 11과 취소된 준비에서는 알림 권한을 요청하지 않는다', async () => {
  const check = jest.spyOn(PermissionsAndroid, 'check');
  Object.defineProperty(Platform, 'Version', { value: 30, configurable: true });
  await prepareRunNotifications(new AbortController().signal);
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
  const controller = new AbortController();
  controller.abort();
  await prepareRunNotifications(controller.signal);
  expect(check).not.toHaveBeenCalled();
});

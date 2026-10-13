import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { locationAdapter, waitForSettingsReturn } from '../locationAdapter';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue(undefined),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue(undefined),
  watchPositionAsync: jest.fn(),
}));
let change: (state: AppStateStatus) => void;
const remove = jest.fn();
const initialAppState = AppState.currentState;
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(30);
  AppState.currentState = 'active';
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove };
  });
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
});
it('설정 열기 Promise가 끝나도 active 복귀 전에는 대기가 끝나지 않는다', async () => {
  const done = jest.fn();
  const pending = waitForSettingsReturn(
    () => Linking.openSettings(),
    new AbortController().signal,
  ).then(done);
  await Promise.resolve();
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  change('background');
  change('active');
  await pending;
  expect(done).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
it('설정 이동 취소 시 AppState 리스너를 정리한다', async () => {
  const controller = new AbortController();
  const pending = waitForSettingsReturn(() => Linking.openSettings(), controller.signal);
  const rejection = expect(pending).rejects.toThrow('cancelled');
  controller.abort();
  await rejection;
  expect(remove).toHaveBeenCalledTimes(1);
});
it('Android 11에서 백그라운드 권한은 OS 설정으로 이동한다', async () => {
  const pending = locationAdapter.requestPermission('background', new AbortController().signal);
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  change('background');
  change('active');
  await pending;
});
it('포그라운드 권한은 Expo OS 요청을 사용한다', async () => {
  await locationAdapter.requestPermission('foreground', new AbortController().signal);
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

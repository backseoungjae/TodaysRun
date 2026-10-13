import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { AppState, Button, Text, type AppStateStatus } from 'react-native';
import { locationAdapter } from '../../services/locationAdapter';
import { useRunPreparation } from '../useRunPreparation';

jest.mock('@/features/settings/settingsService', () => ({
  settingsService: {
    get: jest.fn().mockResolvedValue({ backgroundTrackingEnabled: true }),
  },
}));
jest.mock('../../services/locationAdapter', () => ({
  locationAdapter: {
    getPermission: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
    servicesEnabled: jest.fn().mockResolvedValue(true),
    watch: jest.fn(),
  },
  confirmLocationPermission: jest.fn(),
}));

function PreparationHarness() {
  const { state, start, cancel } = useRunPreparation();
  return (
    <>
      <Text>{state.status}</Text>
      <Button title="START" onPress={() => void start()} />
      <Button title="취소" onPress={cancel} />
      <Button title="화면 이동" onPress={() => router.push('/activity')} />
    </>
  );
}
const initialState = AppState.currentState;
const remove = jest.fn();
let listeners = new Set<(state: AppStateStatus) => void>();
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback);
    return {
      remove: () => {
        listeners.delete(callback);
      },
    };
  });
  jest.mocked(locationAdapter.watch).mockResolvedValue({ remove });
});
afterEach(() => {
  AppState.currentState = initialState;
  jest.restoreAllMocks();
});
async function startWaiting() {
  await renderRouter({ index: PreparationHarness, activity: () => <Text>다른 화면</Text> });
  await fireEvent.press(screen.getByText('START'));
  await screen.findByText('waitingForLocation');
}
it('Home 이탈 시 위치 구독을 제거한다', async () => {
  await startWaiting();
  await fireEvent.press(screen.getByText('화면 이동'));
  await screen.findByText('다른 화면');
  expect(remove).toHaveBeenCalledTimes(1);
});
it('앱이 백그라운드로 전환되면 GPS 준비를 취소한다', async () => {
  await startWaiting();
  await act(async () => {
    for (const callback of listeners) callback('background');
  });
  expect(await screen.findByText('idle')).toBeOnTheScreen();
  expect(remove).toHaveBeenCalledTimes(1);
});
it('컴포넌트 해제 후 늦은 위치 콜백은 구독을 재시작하지 않는다', async () => {
  await startWaiting();
  const receive = jest.mocked(locationAdapter.watch).mock.calls[0][0];
  await screen.unmount();
  receive({ latitude: 0, longitude: 0, accuracyMeters: 5, timestampMs: Date.now() });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(locationAdapter.watch).toHaveBeenCalledTimes(1);
});

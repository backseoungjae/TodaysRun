import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import SettingsScreen from '../SettingsScreen';
import { runHistoryService } from '@/features/run/services/runHistoryService';
import { runStore } from '@/features/run/store/runStore';

jest.mock('@/features/run/services/runHistoryService', () => ({
  runHistoryService: { deletionBlock: jest.fn(), removeAll: jest.fn() },
}));
jest.mock('../settingsService', () => ({
  settingsService: {
    get: jest.fn().mockResolvedValue({ backgroundTrackingEnabled: true }),
    setBackgroundTrackingEnabled: jest.fn(),
  },
}));
jest.mock('@/features/run/services/locationAdapter', () => ({
  locationAdapter: {
    getPermission: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
    openSettings: jest.fn(),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  runStore.setState({ id: null, status: null, busy: false });
  jest.mocked(runHistoryService.deletionBlock).mockResolvedValue(null);
  jest.mocked(runHistoryService.removeAll).mockResolvedValue(undefined);
});
afterEach(() => runStore.setState({ id: null, status: null, busy: false }));
async function mount() {
  await renderRouter({ index: SettingsScreen });
  await waitFor(() => expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeEnabled());
}
async function confirm(alert: jest.SpyInstance, text: string) {
  await act(async () => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button: { text: string }) => button.text === text)
      ?.onPress?.();
  });
}
it('전체 삭제 취소는 아무 작업도 하지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await mount();
  await userEvent.setup().press(screen.getByRole('button', { name: '전체 기록 삭제' }));
  expect(alert.mock.calls[0][1]).toContain('복구할 수 없어요');
  await confirm(alert, '취소');
  expect(runHistoryService.removeAll).not.toHaveBeenCalled();
});
it('전체 삭제 성공은 실제 결과와 설정 유지 안내를 표시한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await mount();
  await userEvent.setup().press(screen.getByRole('button', { name: '전체 기록 삭제' }));
  await confirm(alert, '전체 삭제');
  expect(
    await screen.findByText('모든 러닝 기록과 경로를 삭제했어요. 앱 설정은 유지돼요.'),
  ).toBeOnTheScreen();
  expect(runHistoryService.removeAll).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toHaveProp('value', true);
});
it('전체 삭제 실패는 성공 표시를 하지 않고 재시도할 수 있다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  jest.mocked(runHistoryService.removeAll).mockRejectedValueOnce(new Error('disk-full'));
  await mount();
  await userEvent.setup().press(screen.getByRole('button', { name: '전체 기록 삭제' }));
  await confirm(alert, '전체 삭제');
  expect(
    await screen.findByText('전체 기록을 삭제하지 못했어요. 다시 시도해 주세요.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/모든 러닝 기록과 경로를 삭제했어요/)).toBeNull();
  await userEvent.setup().press(screen.getByRole('button', { name: '전체 기록 삭제' }));
  await confirm(alert, '전체 삭제');
  expect(await screen.findByText(/모든 러닝 기록과 경로를 삭제했어요/)).toBeOnTheScreen();
});
it('활성 Store 표시 상태는 전체 삭제 버튼을 차단한다', async () => {
  runStore.setState({ id: 'active', status: 'PAUSED' });
  await renderRouter({ index: SettingsScreen });
  await screen.findByText('포그라운드 위치: 허용');
  expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeDisabled();
  expect(runHistoryService.removeAll).not.toHaveBeenCalled();
});
it('Store가 비어도 영구 미완료 기록의 복구 전에는 삭제를 차단한다', async () => {
  jest
    .mocked(runHistoryService.deletionBlock)
    .mockResolvedValue('미완료 기록을 복구한 후 전체 기록을 삭제해 주세요.');
  await renderRouter({ index: SettingsScreen });
  expect(await screen.findByText(/미완료 기록을 복구한 후/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeDisabled();
});
it('상태 조회 실패는 삭제를 허용하지 않는다', async () => {
  jest.mocked(runHistoryService.deletionBlock).mockRejectedValue(new Error('database-unavailable'));
  await renderRouter({ index: SettingsScreen });
  await screen.findAllByText(/기록 상태를 확인하지 못했어요/);
  expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeDisabled();
});
it('전체 삭제 확인 콜백과 입력이 반복되어도 한 번만 삭제한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let resolve!: () => void;
  jest.mocked(runHistoryService.removeAll).mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await mount();
  const button = screen.getByRole('button', { name: '전체 기록 삭제' });
  await userEvent.setup().press(button);
  await userEvent.setup().press(button);
  expect(alert).toHaveBeenCalledTimes(1);
  await confirm(alert, '전체 삭제');
  await confirm(alert, '전체 삭제');
  expect(runHistoryService.removeAll).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '삭제 중…' })).toBeDisabled();
  await act(async () => resolve());
});

it('삭제 조건 재조회 성공은 이전 조회 오류를 지우고 삭제를 허용한다', async () => {
  jest.mocked(runHistoryService.deletionBlock).mockRejectedValueOnce(new Error('offline'));
  await renderRouter({ index: SettingsScreen });
  await screen.findByText('기록 상태를 확인하지 못했어요. 다시 확인해 주세요.');
  await userEvent.setup().press(screen.getByRole('button', { name: '삭제 조건 다시 확인' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeEnabled());
  expect(screen.queryByText('기록 상태를 확인하지 못했어요. 다시 확인해 주세요.')).toBeNull();
});

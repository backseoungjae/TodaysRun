import { fireEvent, screen, waitFor, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import SettingsScreen from '../SettingsScreen';
import { settingsService } from '../settingsService';
import { locationAdapter } from '@/features/run/services/locationAdapter';

jest.mock('@/features/run/services/runHistoryService', () => ({
  runHistoryService: { deletionBlock: jest.fn().mockResolvedValue(null), removeAll: jest.fn() },
}));

jest.mock('../settingsService', () => ({
  settingsService: {
    get: jest.fn(),
    setBackgroundTrackingEnabled: jest.fn(),
  },
}));
jest.mock('@/features/run/services/locationAdapter', () => ({
  locationAdapter: {
    getPermission: jest.fn(),
    openSettings: jest.fn(),
  },
}));
let backgroundEnabled = false;
beforeEach(() => {
  jest.clearAllMocks();
  backgroundEnabled = false;
  jest
    .mocked(settingsService.get)
    .mockImplementation(async () => ({ backgroundTrackingEnabled: backgroundEnabled }));
  jest.mocked(settingsService.setBackgroundTrackingEnabled).mockImplementation(async (value) => {
    backgroundEnabled = value;
  });
  jest
    .mocked(locationAdapter.getPermission)
    .mockResolvedValue({ granted: false, canAskAgain: true });
  jest.mocked(locationAdapter.openSettings).mockResolvedValue(undefined);
});

it('실제 권한과 삭제 가능 상태를 조회해서 표시한다', async () => {
  await renderRouter({ index: SettingsScreen });
  expect(await screen.findByText('포그라운드 위치: 허용되지 않음')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '기기 설정 열기' })).toBeEnabled();
  await waitFor(() => expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeEnabled());
  expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toBeEnabled();
  expect(screen.getByText(/앱 내부 사용 설정을 저장해요/)).toBeOnTheScreen();
});

it('토글 변경은 저장 후 다시 조회하며 화면 재진입에도 유지한다', async () => {
  const first = renderRouter({ index: SettingsScreen });
  await first;
  await screen.findByText('포그라운드 위치: 허용되지 않음');
  await fireEvent(
    screen.getByRole('switch', { name: '백그라운드 기록 사용' }),
    'valueChange',
    true,
  );
  await waitFor(() =>
    expect(settingsService.setBackgroundTrackingEnabled).toHaveBeenCalledWith(true),
  );
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toHaveProp('value', true),
  );
  await screen.unmount();
  await renderRouter({ index: SettingsScreen });
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toHaveProp('value', true),
  );
});
it('설정 복귀 후 OS 권한을 다시 조회한다', async () => {
  await renderRouter({ index: SettingsScreen });
  await screen.findByText('포그라운드 위치: 허용되지 않음');
  jest.mocked(locationAdapter.openSettings).mockImplementation(async () => {
    jest
      .mocked(locationAdapter.getPermission)
      .mockResolvedValue({ granted: true, canAskAgain: true });
  });
  await userEvent.setup().press(screen.getByRole('button', { name: '기기 설정 열기' }));
  expect(await screen.findByText('포그라운드 위치: 허용')).toBeOnTheScreen();
});
it('설정 저장 실패를 성공으로 표시하지 않는다', async () => {
  await renderRouter({ index: SettingsScreen });
  await screen.findByText('포그라운드 위치: 허용되지 않음');
  jest
    .mocked(settingsService.setBackgroundTrackingEnabled)
    .mockRejectedValue(new Error('disk-full'));
  await fireEvent(
    screen.getByRole('switch', { name: '백그라운드 기록 사용' }),
    'valueChange',
    true,
  );
  expect(
    await screen.findByText('설정을 저장하지 못했어요. 다시 시도해 주세요.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toHaveProp('value', false);
});

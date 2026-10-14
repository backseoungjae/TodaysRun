import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import RootLayout from '@/app/_layout';
import DrawerLayout from '@/app/(drawer)/_layout';
import HomeScreen from '@/features/home/HomeScreen';
import ActivityScreen from '@/features/activity/ActivityScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';

jest.mock('@/features/run/services/runHistoryService', () => ({
  runHistoryService: {
    list: jest.fn().mockResolvedValue([]),
    deletionBlock: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/features/settings/settingsService', () => ({
  settingsService: {
    get: jest.fn().mockResolvedValue({ backgroundTrackingEnabled: false }),
  },
}));
jest.mock('@/features/run/services/locationAdapter', () => ({
  locationAdapter: {
    getPermission: jest.fn().mockResolvedValue({ granted: false, canAskAgain: true }),
  },
}));

it('햄버거 메뉴로 Drawer를 열고 Home, Activity, Settings 사이를 이동한다', async () => {
  const result = renderRouter(
    {
      _layout: RootLayout,
      running: () => null,
      'run-result/[runId]': () => null,
      '(drawer)/_layout': DrawerLayout,
      '(drawer)/index': HomeScreen,
      '(drawer)/activity': ActivityScreen,
      '(drawer)/settings': SettingsScreen,
    },
    { initialUrl: '/' },
  );
  await result;
  const user = userEvent.setup();
  expect(result.getPathname()).toBe('/');
  expect(screen.getByRole('button', { name: 'START' })).toBeEnabled();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Activity'));
  await waitFor(() => expect(result.getPathname()).toBe('/activity'));
  expect(await screen.findByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Settings'));
  await waitFor(() => expect(result.getPathname()).toBe('/settings'));
  expect(await screen.findByText('포그라운드 위치: 허용되지 않음')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Home'));
  await waitFor(() => expect(result.getPathname()).toBe('/'));
  expect(screen.getByRole('button', { name: 'START' })).toBeEnabled();
});

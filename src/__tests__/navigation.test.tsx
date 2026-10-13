import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import RootLayout from '@/app/_layout';
import DrawerLayout from '@/app/(drawer)/_layout';
import HomeScreen from '@/features/home/HomeScreen';
import ActivityScreen from '@/features/activity/ActivityScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';

it('햄버거 메뉴로 Drawer를 열고 Home, Activity, Settings 사이를 이동한다', async () => {
  const result = renderRouter(
    {
      _layout: RootLayout,
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
  expect(screen.getByRole('button', { name: 'START' })).toBeDisabled();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Activity'));
  await waitFor(() => expect(result.getPathname()).toBe('/activity'));
  expect(screen.getByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Settings'));
  await waitFor(() => expect(result.getPathname()).toBe('/settings'));
  expect(screen.getByText('권한 상태를 아직 확인하지 않았어요.')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: '메뉴 열기' }));
  await user.press(await screen.findByText('Home'));
  await waitFor(() => expect(result.getPathname()).toBe('/'));
  expect(screen.getByRole('button', { name: 'START' })).toBeDisabled();
});

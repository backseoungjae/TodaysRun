import { render, screen } from '@testing-library/react-native';
import SettingsScreen from '../SettingsScreen';

it('권한을 미확인으로 표시하고 미구현 설정은 조작할 수 없게 한다', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByText('권한 상태를 아직 확인하지 않았어요.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '기기 설정 열기' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '전체 기록 삭제' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: '백그라운드 기록 사용' })).toBeDisabled();
  expect(screen.getByText(/표시된 값은 저장된 설정이 아니에요/)).toBeOnTheScreen();
});

import { render, screen, userEvent } from '@testing-library/react-native';
import HomeScreen from '../HomeScreen';

it('START를 표시하지만 준비 중에는 러닝을 시작하지 않는다', async () => {
  await render(<HomeScreen />);
  const start = screen.getByRole('button', { name: 'START' });
  expect(start).toBeDisabled();
  await userEvent.setup().press(start);
  expect(screen.getByText(/지금은 운동을 시작할 수 없어요/)).toBeOnTheScreen();
});

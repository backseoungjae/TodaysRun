import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from './tokens/colors';

export function useUiTheme() {
  const isDark = useColorScheme() === 'dark';
  return { isDark, colors: Colors[isDark ? 'dark' : 'light'] };
}

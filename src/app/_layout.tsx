import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useUiTheme } from '@/shared/ui/useUiTheme';

export default function RootLayout() {
  const { colors, isDark } = useUiTheme();
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider
        value={{
          ...baseTheme,
          colors: {
            ...baseTheme.colors,
            background: colors.background,
            card: colors.surface,
            text: colors.text,
            border: colors.border,
            primary: colors.text,
          },
        }}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack>
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

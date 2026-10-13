import { Drawer } from 'expo-router/drawer';
import { StyleSheet, View } from 'react-native';
import { IconButton } from '@/shared/ui/components/IconButton';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { Typography } from '@/shared/ui/tokens/typography';
import { useUiTheme } from '@/shared/ui/useUiTheme';

export default function DrawerLayout() {
  const { colors } = useUiTheme();
  return (
    <Drawer
      initialRouteName="index"
      screenOptions={({ navigation }) => ({
        drawerPosition: 'left',
        drawerType: 'front',
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: Typography.heading,
        headerShadowVisible: false,
        drawerStyle: { backgroundColor: colors.surface },
        drawerActiveBackgroundColor: colors.primary,
        drawerActiveTintColor: colors.onPrimary,
        drawerInactiveTintColor: colors.text,
        drawerLabelStyle: Typography.button,
        drawerItemStyle: { minHeight: 48 },
        headerLeft: () => (
          <IconButton
            accessibilityLabel="메뉴 열기"
            onPress={() => navigation.toggleDrawer()}
            style={styles.menu}
          >
            <View accessible={false} style={styles.lines}>
              {[0, 1, 2].map((line) => (
                <View key={line} style={[styles.line, { backgroundColor: colors.text }]} />
              ))}
            </View>
          </IconButton>
        ),
      })}
    >
      <Drawer.Screen name="index" options={{ drawerLabel: 'Home', title: 'TodaysRun' }} />
      <Drawer.Screen name="activity" options={{ drawerLabel: 'Activity', title: 'Activity' }} />
      <Drawer.Screen name="settings" options={{ drawerLabel: 'Settings', title: 'Settings' }} />
    </Drawer>
  );
}
const styles = StyleSheet.create({
  menu: { marginLeft: Spacing.sm },
  lines: { gap: Spacing.xs },
  line: { width: 20, height: 2, borderRadius: 1 },
});

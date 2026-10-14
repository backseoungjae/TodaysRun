import { View, StyleSheet } from 'react-native';
import { AppText } from '@/shared/ui/components/AppText';
import { Spacing } from '@/shared/ui/tokens/spacing';
import type { Coordinate } from '../domain/runTypes';
import type { PathPoint } from './RunMap';

export function RunMap(_props: {
  current: Coordinate | null;
  path: readonly PathPoint[];
  sheetFraction?: number;
  containerHeight?: number;
}) {
  return (
    <View style={styles.container}>
      <AppText>지도는 Android·iOS 앱에서 확인할 수 있어요.</AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', paddingTop: Spacing.xxl },
});

import type { PropsWithChildren } from 'react';
import { StyleSheet, Switch, View, Platform } from 'react-native';
import { AppButton } from '@/shared/ui/components/AppButton';
import { AppText } from '@/shared/ui/components/AppText';
import { Screen } from '@/shared/ui/components/Screen';
import { Radius } from '@/shared/ui/tokens/radius';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { useUiTheme } from '@/shared/ui/useUiTheme';
import appConfig from '../../../app.json';
import { useRecordDeletion } from './useRecordDeletion';
import { useLocationSettings } from './useLocationSettings';
import { useStore } from 'zustand';
import { runStore } from '@/features/run/store/runStore';

function SettingSection({ title, children }: PropsWithChildren<{ title: string }>) {
  const { colors } = useUiTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const deletion = useRecordDeletion();
  const { snapshot, error, saving, refresh, setBackground, openSettings } = useLocationSettings();
  const running = useStore(
    runStore,
    (state) => state.status === 'RUNNING' || state.status === 'PAUSED',
  );
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        설정
      </AppText>
      <SettingSection title="위치 권한">
        {snapshot ? (
          <>
            <AppText>
              포그라운드 위치: {snapshot.foreground.granted ? '허용' : '허용되지 않음'}
            </AppText>
            <AppText>
              백그라운드 위치: {snapshot.background.granted ? '허용' : '허용되지 않음'}
            </AppText>
          </>
        ) : (
          <AppText tone="muted">권한 상태를 아직 확인하지 않았어요.</AppText>
        )}
        <AppButton label="기기 설정 열기" variant="secondary" onPress={() => void openSettings()} />
        <AppText variant="caption" tone="muted">
          권한은 기기 설정에서 변경해 주세요. 앱에 돌아오면 다시 확인해요.
        </AppText>
      </SettingSection>
      <SettingSection title="백그라운드 기록">
        <View style={styles.row}>
          <AppText style={styles.rowLabel}>백그라운드 기록 사용</AppText>
          <Switch
            value={snapshot?.backgroundTrackingEnabled ?? false}
            disabled={!snapshot || saving || running}
            onValueChange={(value) => void setBackground(value)}
            accessibilityState={{
              disabled: !snapshot || saving || running,
              checked: snapshot?.backgroundTrackingEnabled ?? false,
            }}
            accessibilityLabel="백그라운드 기록 사용"
            accessibilityHint="앱 내부 사용 설정이며 OS 위치 권한은 기기 설정에서 별도로 변경합니다."
          />
        </View>
        <AppText variant="caption" tone="muted">
          {Platform.OS === 'android'
            ? '앱 내부 사용 설정을 저장해요. 러닝 중에는 위치 알림과 함께 백그라운드 기록을 사용해요.'
            : '앱 내부 사용 설정을 저장해요. 실제 백그라운드 위치 기록 기능은 아직 준비 중이에요.'}
        </AppText>
      </SettingSection>
      {error && (
        <>
          <AppText accessibilityRole="alert">{error}</AppText>
          <AppButton label="설정 다시 확인" variant="secondary" onPress={() => void refresh()} />
        </>
      )}
      <SettingSection title="데이터 초기화">
        <AppText tone="muted">러닝 기록과 경로를 삭제하는 기능이에요.</AppText>
        <AppButton
          label={deletion.deleting ? '삭제 중…' : '전체 기록 삭제'}
          variant="danger"
          disabled={deletion.disabled}
          onPress={deletion.removeAll}
        />
        {deletion.checking && <AppText tone="muted">러닝 상태를 확인하고 있어요…</AppText>}
        {deletion.blocked && <AppText tone="muted">{deletion.blocked}</AppText>}
        {deletion.message && <AppText accessibilityRole="alert">{deletion.message}</AppText>}
        {deletion.error && (
          <>
            <AppText accessibilityRole="alert">{deletion.error}</AppText>
            <AppButton label="삭제 조건 다시 확인" onPress={() => void deletion.refresh()} />
          </>
        )}
        <AppText variant="caption" tone="muted">
          앱 설정과 데이터베이스 구조는 유지돼요.
        </AppText>
      </SettingSection>
      <SettingSection title="앱 소개">
        <AppText>TodaysRun · {appConfig.expo.version}</AppText>
        <AppText tone="muted">달리기에 집중하고, 기록은 정확하게.</AppText>
        <AppText variant="caption" tone="muted">
          로그인 없이 러닝 기록과 경로를 기기 안에 저장해요.
        </AppText>
      </SettingSection>
    </Screen>
  );
}
const styles = StyleSheet.create({
  section: { padding: Spacing.xl, gap: Spacing.md, borderRadius: Radius.lg, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowLabel: { flex: 1 },
});

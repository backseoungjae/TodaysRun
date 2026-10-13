import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { Radius } from '../tokens/radius';
import { TouchTarget } from '../tokens/spacing';
import { useUiTheme } from '../useUiTheme';

type IconButtonProps = Omit<PressableProps, 'children' | 'accessibilityLabel'> & {
  children: ReactNode;
  accessibilityLabel: string;
};

export function IconButton({
  children,
  accessibilityLabel,
  disabled = false,
  accessibilityState,
  style,
  ...props
}: IconButtonProps) {
  const { colors } = useUiTheme();
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      style={(state) => [
        styles.button,
        {
          opacity: disabled ? 0.5 : 1,
          backgroundColor: state.pressed ? colors.disabled : 'transparent',
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: TouchTarget,
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

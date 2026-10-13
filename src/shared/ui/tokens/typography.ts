import type { TextStyle } from 'react-native';

export const Typography = {
  title: { fontSize: 32, lineHeight: 42, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 25 },
  caption: { fontSize: 14, lineHeight: 22 },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
} satisfies Record<string, TextStyle>;

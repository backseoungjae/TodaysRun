import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function ({ config }: ConfigContext): ExpoConfig {
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  if (!androidMapsKey)
    throw new Error('루트 .env.local에 GOOGLE_MAPS_ANDROID_API_KEY를 설정해 주세요.');
  return {
    ...config,
    name: config.name ?? 'TodaysRun',
    slug: config.slug ?? 'TodaysRun',
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey: androidMapsKey }],
    ],
  };
}

import { memo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Coordinate } from '../domain/runTypes';
import { useUiTheme } from '@/shared/ui/useUiTheme';

export type PathPoint = Coordinate & { segmentId: number; timestampMs: number };
export function pathSegments(points: readonly PathPoint[]): Coordinate[][] {
  const segments = new Map<number, Coordinate[]>();
  for (const point of points) {
    const segment = segments.get(point.segmentId) ?? [];
    segment.push({ latitude: point.latitude, longitude: point.longitude });
    segments.set(point.segmentId, segment);
  }
  return [...segments.values()].filter((segment) => segment.length >= 2);
}

export const RunMap = memo(function RunMap({
  current,
  path,
  sheetFraction = 0.7,
  containerHeight,
  fitPath = false,
}: {
  current: Coordinate | null;
  path: readonly PathPoint[];
  sheetFraction?: number;
  containerHeight?: number;
  fitPath?: boolean;
}) {
  // 최초 위치에서만 초기 중심을 정한다. 이후 region을 제어하지 않아 사용자 이동을 유지한다.
  const initial = useRef(current);
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const { colors } = useUiTheme();
  const { height: windowHeight } = useWindowDimensions();
  const height = containerHeight ?? windowHeight;
  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={
        initial.current
          ? { ...initial.current, latitudeDelta: 0.008, longitudeDelta: 0.008 }
          : undefined
      }
      showsMyLocationButton={false}
      toolbarEnabled={false}
      mapPadding={
        ready
          ? { top: 0, left: 0, right: 0, bottom: Math.round(height * sheetFraction) }
          : undefined
      }
      accessibilityLabel="러닝 지도"
      onMapReady={() => {
        setReady(true);
        if (fitPath && path.length >= 2)
          map.current?.fitToCoordinates([...path], {
            edgePadding: { top: 24, bottom: 24, left: 24, right: 24 },
            animated: false,
          });
        else if (initial.current)
          map.current?.animateCamera({ center: initial.current, zoom: 16 }, { duration: 0 });
      }}
    >
      {current && (
        <Marker coordinate={current} title={fitPath ? '저장된 마지막 위치' : '현재 유효 위치'} />
      )}
      {pathSegments(path).map((coordinates, index) => (
        <Polyline key={index} coordinates={coordinates} strokeWidth={5} strokeColor={colors.text} />
      ))}
    </MapView>
  );
});

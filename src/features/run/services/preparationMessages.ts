export function preparationMessage(reason: string): string {
  switch (reason) {
    case 'expo-go-unsupported':
      return 'Expo Go에서는 화면만 확인할 수 있어요. 러닝 기록은 Android 개발 빌드에서 사용할 수 있어요.';
    case 'background-setting-off':
      return 'Settings에서 백그라운드 기록 사용을 켜 주세요. 실제 기록 기능은 아직 준비 중이에요.';
    case 'foreground-denied':
      return '위치 권한이 거절되었어요. 재시도 시 다시 요청할 수 있어요.';
    case 'foreground-blocked':
      return '위치 권한을 다시 요청할 수 없어요. 재시도 후 기기 설정에서 허용해 주세요.';
    case 'background-denied':
      return '백그라운드 위치 권한이 허용되지 않았어요. 설정 이동을 취소했거나 권한을 거절한 경우 다시 시도해 주세요.';
    case 'background-blocked':
      return '백그라운드 위치 권한이 없어요. 재시도 후 기기 설정에서 항상 허용을 선택해 주세요.';
    case 'permission-cancelled':
      return '권한 요청 안내를 취소했어요. 러닝은 시작되지 않았어요.';
    case 'permission-revoked':
      return '위치 권한이 변경되었어요. 다시 확인해 주세요.';
    case 'services-off':
      return '기기의 위치 서비스를 켠 뒤 다시 시도해 주세요.';
    case 'location-timeout':
      return '15초 동안 정확한 위치를 받지 못했어요. 야외에서 재시도하거나 취소해 주세요.';
    case 'location-lost':
      return '유효한 위치를 잃었어요. 다시 위치를 준비해 주세요.';
    case 'app-inactive':
      return '앱을 떠나 위치 준비를 중단했어요. 다시 시도해 주세요.';
    default:
      if (/[가-힣]/.test(reason)) return reason;
      return '위치 준비에 실패했어요. 권한과 위치 서비스를 확인한 뒤 다시 시도해 주세요.';
  }
}

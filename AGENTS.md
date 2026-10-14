# TodaysRun — AGENTS.md

> Codex 작업 지침 · React Native + Expo + TypeScript · Android 우선

이 문서는 **개발 방법과 코드 규칙**을 정의한다. **제품 기능·화면·예외 처리의 기준은 `docs/PRODUCT_SPEC.md`**다. 두 문서와 요청 사항이 충돌하거나 제품 동작을 바꿔야 한다면 임의로 결정하지 말고 먼저 질문한다.

## 1. 기본 원칙

- 이 앱은 **GPS 기반 자유 러닝 기록**에 집중하는 **Local-first MVP**다. 로그인·서버·훈련 계획·고급 통계 등 명세 밖 기능은 추가하지 않는다.
- 작업 전 `docs/PRODUCT_SPEC.md`, 현재 코드·테스트, `package.json`, Expo 설정을 확인한다. 기존 Expo Router 구조를 먼저 파악하고 불필요하게 이동하거나 초기화하지 않는다.
- **한 번에 한 기능/Phase만** 작업한다. 요청하지 않은 리팩터링, 라이브러리 추가, 파일 생성, 폴더 확장, UI 변경은 피한다.
- 기능별 완료 조건과 테스트를 먼저 정한다. 핵심 비즈니스 로직은 가능한 한 **Red → Green → Refactor(TDD)** 순서로 개발한다.
- 타입 오류나 테스트 실패를 숨기기 위해 테스트를 삭제·완화하거나 `any`, `@ts-ignore`, 무분별한 타입 단언을 사용하지 않는다.
- 코드는 영어 식별자, 작업 설명·주석이 필요한 이유·문서·커밋 제목은 한국어를 기본으로 한다.
- API 키, 정확한 개인 GPS 좌표, 실제 생활 반경이 노출되는 로그·스크린샷·테스트 데이터는 커밋하지 않는다. 테스트에는 가상의 좌표를 사용한다.

## 2. 아키텍처: Feature-based + 필요한 내부 계층

기능별 코드를 모으고, 복잡한 기능 안에서만 UI·로직·저장을 분리한다. **폴더 구조는 가이드이며 필요할 때만 생성**한다.

```text
src/
├── app/                      # Expo Router: 라우트와 내비게이션 연결
├── features/
│   ├── home/
│   ├── run/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── domain/          # 순수 계산·상태 전이
│   │   ├── services/        # 위치 추적·러닝 생명주기 조정
│   │   └── store/           # 진행 중 운동의 UI 상태
│   ├── activity/
│   └── settings/
├── database/
│   ├── migrations/
│   └── repositories/
└── shared/
    └── ui/
        ├── tokens/          # 색상·간격·타이포그래피 등
        └── components/      # 여러 기능에서 재사용하는 UI
```

- 프로젝트에 이미 루트 `app/` 폴더가 있으면 **그 구조를 유지**해도 된다. 라우트 이동은 명시적 요청이 있을 때만 한다.
- 기본 책임: **Screen/Component → Hook → Service/Domain → Repository → SQLite**. 단순 화면에 불필요한 레이어를 만들지 않는다.
- Screen은 렌더링과 사용자 조작, Hook은 화면과 도메인 동작의 연결, Domain은 부작용 없는 계산·상태 전이, Service는 GPS/시간/저장 작업 조정을 담당한다.
- **SQL은 Repository/DB 계층에서만 실행**한다. 화면·컴포넌트·Hook에서 SQL을 직접 호출하지 않는다.
- 기능에만 쓰는 컴포넌트는 해당 `features/<기능>/`에 둔다. 실제 여러 기능에서 공유하는 것만 `shared/`로 이동하고 순환 의존성을 만들지 않는다.

## 3. 파일명 및 코드 스타일

| 종류 | 규칙 | 예시 |
| --- | --- | --- |
| Screen / View / React Component | **PascalCase (첫 글자 대문자)** | `HomeScreen.tsx`, `RunningScreen.tsx`, `RunBottomSheet.tsx` |
| Hook | **camelCase**, `use` 접두어 | `useRunSession.ts`, `useLocationPermission.ts` |
| Service / Repository / Utility | **camelCase** | `runService.ts`, `runRepository.ts`, `calculatePace.ts` |
| Zustand Store | **camelCase** | `runStore.ts` |
| 타입/상수 파일 | **camelCase** | `runTypes.ts`, `gpsPolicy.ts` |
| 폴더 | **소문자 또는 kebab-case** | `features/run`, `shared/ui` |

- Expo Router의 **예약 파일명은 예외**다: `_layout.tsx`, `index.tsx`, `[runId].tsx`, `(drawer)` 등 라우트 규약을 우선한다. 실제 화면 컴포넌트는 `ActivityDetailScreen.tsx`처럼 PascalCase로 분리한다.
- TypeScript `strict`를 유지하고 외부 입력·SQLite 조회 결과·위치 데이터를 검증한다. 계산 데이터의 단위와 null 가능성을 명시한다.
- 역할을 알 수 있는 이름을 사용한다. 한 파일에 화면, GPS 필터, DB 저장 로직을 모두 넣지 않는다.

## 4. 최소 디자인 시스템과 UX

- `shared/ui/tokens`에서 공통 색상·간격·타이포그래피·둥근 모서리 값을 관리한다. 임의의 스타일 상수를 여러 화면에 복사하지 않는다.
- 공통 `AppButton`, `IconButton`, `AppText` 등은 **실제 재사용 수요가 있을 때** 구현한다. 처음부터 Storybook이나 과도한 컴포넌트 계층을 만들지 않는다.
- 공통 UI는 기능별 Store·Repository를 직접 참조하지 않는다. 상태·동작은 props로 받는다.
- 터치 요소의 접근성 이름·상태, 충분한 터치 영역, 큰 글씨, 로딩·오류·빈 화면을 고려한다. 아이콘 단독 버튼에는 접근성 레이블을 제공한다.
- `docs/PRODUCT_SPEC.md`의 UX를 유지한다: **Drawer**, 원형 `START`, 일회성 **3초 카운트다운**, Running의 **Draggable Bottom Sheet**, `RUNNING → PAUSED → 재개/종료`.
- 지도 제스처와 Bottom Sheet 드래그가 충돌하지 않게 하고, 시트 크기가 바뀌어도 러닝 기록은 중단되지 않게 한다. 두 시트 상태 모두에서 운동 제어 버튼을 사용할 수 있어야 한다.
- 저장 성공 전 결과 화면으로 이동하거나 실패를 성공 메시지로 바꾸지 않는다. 뒤로가기는 **종료 직후 → Home / Activity 상세 → Activity** 규칙을 지킨다.

## 5. 상태 관리: Zustand와 SQLite의 책임

- **Zustand**: 진행 중 운동의 화면 표시 상태(거리·시간·페이스·현재 위치·러닝 UI 상태 등). 필요한 selector만 구독해 GPS 업데이트에 따른 불필요한 렌더링을 줄인다.
- **SQLite**: 운동 기록, GPS 좌표, 앱 설정의 **영구 데이터 원본(Source of Truth)**. 완료 기록 전체를 Zustand에 중복 저장하지 않는다.
- **Bottom Sheet의 확장/축소 상태**처럼 해당 화면에서만 필요한 상태는 컴포넌트 로컬 상태로 관리한다.
- **OS 위치 권한**은 시스템에서 조회한다. Settings의 백그라운드 토글은 앱 내부 사용 설정이지 OS 권한 토글이 아니다.
- 백그라운드 위치 콜백은 React 화면 마운트나 Zustand 메모리 상태에 의존하지 않게 설계한다. SQLite를 기준으로 복구할 수 있어야 한다.
- 시계·GPS 이벤트·DB 쓰기 순서가 꼬이지 않도록 단일 러닝 세션 식별자, 직렬화된 쓰기, 중복 이벤트 방지를 고려한다.

## 6. GPS·러닝 상태·저장 규칙

- GPS 원본을 그대로 신뢰하지 않는다. 정확도, 시각, 중복, 비현실적 속도/점프를 검증한 **유효 좌표만** 경로·거리에 반영한다.
- 거리 원본 단위는 **meter**, 운동 시간은 **millisecond**, 위치 시각은 명확한 epoch millisecond로 통일한다. UI에서만 km / mm:ss / min/km로 변환한다.
- `READY → COUNTDOWN → RUNNING ↔ PAUSED → COMPLETED` 상태 전이를 명시적으로 제한한다. 카운트다운 취소 시 `runs` 레코드를 만들지 않는다.
- 사용자가 종료를 확정한 0km·짧은 기록도 저장·표시한다. 최소 거리·시간 조건과 GPS 불안정에 따른 자동 삭제를 도입하지 않는다. 거리 0의 페이스는 `--'--"`로 표시한다.
- Pause 중 운동 시간·거리 증가를 중단하고, Resume 및 장시간 GPS 손실 뒤에는 경로 구간을 분리해 잘못된 직선 연결을 막는다.
- 유효 GPS 좌표 삽입과 누적 거리 갱신은 **하나의 Transaction**으로 처리한다. 실패하면 함께 롤백하며 UI에 저장 성공으로 반영하지 않는다.
- 약 **5초마다 운동 시간 체크포인트**를 저장하되 이는 초기 가설이다. 실제 동작·배터리·쓰기 비용을 검증해 조정한다. Pause/Resume/Finish는 상태 변경을 안전하게 저장한다.
- 최초 DB 스키마는 `migration001`을 기준으로 잡는다. **Phase가 끝났다는 이유만으로 새 Migration을 추가하지 않는다.** 배포 후 데이터 보존이 필요한 스키마 변경에만 후속 Migration을 추가한다.
- 앱 재시작 시 미완료 운동을 발견하면 추적·쓰기 상태를 정리하고 **종료 및 저장 / 삭제**만 제공한다. 자동 이어하기나 중단 중 이동 거리 추정은 구현하지 않는다.
- 개별 러닝 삭제는 관련 GPS 좌표까지 삭제(`ON DELETE CASCADE`). 전체 초기화는 앱 설정과 스키마를 유지한다. 삭제 직후 늦게 온 콜백의 재저장을 차단한다.
- Android 포그라운드·백그라운드 권한은 OS 단계에 맞게 요청한다. 권한 설정 복귀 후 다시 확인하며, 권한이나 OS 제약을 코드로 우회하지 않는다.

## 7. 테스트: TDD + 통합 + Maestro + 실기기

- **TDD 우선:** 거리·페이스 계산, GPS 유효성 검증, 시간 누적, 상태 전이, 경로 구간 분리, 중복 이벤트 등 순수 로직. 먼저 실패 테스트를 실행해 실패 원인을 확인하고 최소 구현 후 리팩터링한다.
- **통합 테스트:** SQLite 초기화/스키마, 외래 키, 좌표+거리 Transaction 롤백, Pause/Resume 저장, 재시작 복구, 삭제·설정 유지. 가능하면 실제 SQLite 동작을 검증하고 Mock의 한계를 구분한다.
- **UI 테스트:** START 로딩·권한 실패·기록 비어 있음·버튼 상태·저장 실패·뒤로가기 등의 사용자 상호작용.
- **Maestro E2E:** 앱 실행 → START → (테스트 가능한 권한/위치 조건) → 카운트다운 → Pause/Resume → 종료 → 결과 → Activity 상세·삭제. 기기·빌드·권한·GPS 주입 조건을 기록한다.
- **Android 실기기:** 실제 GPS, 기기 설정을 통한 권한 변경, 화면 잠금·앱 전환, 백그라운드 제약, 앱 종료·재시작 복구. 자동화 E2E나 Mock 테스트 통과로 실기기 검증을 대신하지 않는다.
- 테스트 데이터는 가상 좌표·고정 시각으로 재현 가능하게 구성하고 네트워크/실제 이동/OS 상태에 의존하는 검증은 별도로 표시한다.
- 라이브러리와 명령어는 현재 `package.json` 및 Expo SDK 호환성을 확인한 뒤 사용한다. **실행하지 않은 테스트는 통과했다고 쓰지 않는다.**

## 8. Codex 작업 진행 및 보고

1. 작업 시작 전 목표·수정 대상·완료 조건·필요 테스트를 간단히 제시한다.
2. 관련 코드를 확인하고 **이번 요청 범위에 해당하는 파일만** 수정한다. 의사결정이 필요한 제품 정책 변경은 질문한다.
3. 핵심 로직은 가능하면 **Red → Green → Refactor** 과정을 지킨다. 단계별로 검증하고 원인을 모른 채 테스트를 삭제·스킵하지 않는다.
4. 종료 시 **변경 파일, 기술적 선택 이유, 실행한 명령과 실제 결과, 미검증 항목, 남은 위험**을 짧게 보고한다.
5. `docs/PRODUCT_SPEC.md`와 구현이 달라지면 사용자의 승인 후 관련 명세도 갱신한다. 별도 Phase 보고서·개발 일지 파일은 요청 없이 만들지 않는다.
6. **Git commit은 단계 검증 후 제목을 제안하고 사용자 승인 뒤 수행한다.** 승인 없이 push·배포·이력 재작성·파괴적 데이터 초기화를 하지 않는다.

## 9. 구현 전 확정해야 하는 항목

아래 사항은 `docs/PRODUCT_SPEC.md`에서 아직 제안·미확정 상태다. 개발자가 묻지 않았는데 임의로 제품 동작을 확정하지 않는다.

- Running에서 Android 시스템 뒤로가기 시 보여줄 확인 UX
- GPS 정확도·속도·오래된 좌표 판정 기준과 GPS 손실 후 경로 분리 기준
- GPS 준비 타임아웃(초기 15초)과 운동 체크포인트 주기(초기 5초)의 실기기 검증값

**원칙: 기능을 늘리기보다, 정한 기능을 정확히 구현하고 검증한다.**

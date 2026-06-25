# CLAUDE.md — Paradise Walk Residence Housekeeping Dashboard

> 이 문서의 목적: 어떤 세션이든 이 repo를 처음 열어도, **이 문서만 읽으면 시스템을 깨뜨리지 않고 작업할 수 있는** 불변의 베이스. 변동성 있는 TODO/진행상황은 여기 적지 않는다 (그건 코드·이슈·세션 메모로 관리).

---

## 1. 시스템 개요
인천공항 인근 9실 무인 단기임대 "Paradise Walk Residence"의 하우스키핑 운영 대시보드.
- repo: `pwr-clair/housekeeping` (GitHub Pages 호스팅)
- **GitHub이 단일 진실 공급원(source of truth).** 작업 컨테이너는 세션마다 초기화되므로, 모든 작업은 GitHub 최신본을 읽는 것에서 시작한다.

## 2. 세션 시작 절차 (필수)
1. GitHub에서 `index.html`과 GAS `Code.gs` 최신본을 읽는다 (GitHub MCP 연결 시 자동, 없으면 사용자가 업로드).
2. 수정은 항상 최신본 기준으로 한다. 옛 버전 위에 덮어쓰지 않는다.
3. 작업 후 변경분은 GitHub에 커밋해 source of truth를 갱신한다.
   - **기본 배포 방식 = `main`에 직접 커밋·push.** 별도 브랜치/PR을 만들지 않는다. (운영자가 사후에 확인하고, 문제가 있으면 `git revert`로 되돌리는 방식을 택했다.)
   - 단, 운영자가 **"PR로 해줘"라고 명시적으로 요청할 때만** 브랜치를 만들고 PR을 연다.

## 3. 아키텍처 (3계층)

```
  [SIRVOY 예약시스템]
        │ webhook
        ▼
  [GAS  Code.gs]  ── 6단계 게스트 메일 발송(GmailApp) / 스케줄 트리거
        │ read·write (?auth=secret)
        ▼
  [Firebase RTDB  paradise-walk-residence-default-rtdb]
        │   app/*  = 하우스키핑 데이터 (이 repo가 쓰는 유일한 네임스페이스)
        ▲ 실시간 구독·쓰기 (로그인 후)
        │
  [index.html  단일 파일 / GitHub Pages]  ← 운영자 대시보드
```

- **프론트(index.html)**: 단일 HTML 파일. Firebase를 직접 실시간 구독/쓰기. 모든 UI가 이 한 파일 안에 있다.
- **GAS(Code.gs)**: SIRVOY webhook 수신(`doPost`), 게스트 메일 자동화, 스케줄 기반 객실 상태 전환. Firebase 접근은 `fbGet/fbSet/fbUpdate/fbDelete` 4개 함수로만 하며, 이들이 `?auth=` (DB secret in `FB_AUTH`)를 자동 부착한다.
- **네임스페이스**: 이 repo의 GAS·프론트는 **`app/*`만 사용한다.** (`cs/*` 같은 CS 엔진 네임스페이스는 이 코드에 존재하지 않음 — 아래 §9 참고.)

## 4. 인증 / 보안 모델 (이미 프로덕션에 잠금 적용 완료 — 모르고 건드리면 즉시 화면이 깨짐)
RTDB는 **이미 `auth != null`로 잠겨 있다.** 비로그인 접근은 전부 401. 따라서 아래는 이론이 아니라 실질 제약이다.
- 로그인 = Firebase Auth. 이름 타이핑 → 가짜 이메일 `{name}@pwr.local`로 변환(대소문자 무관), 6자리 비번. **비번은 Firebase가 관리하며 코드에 없다.**
- 데이터 읽기 시작(`startListeners`)은 반드시 `onAuthStateChanged`(로그인 완료) **이후**에 호출된다. 이 순서를 깨면 규칙에 막혀 화면이 안 뜬다. `initFirebaseData` 자동실행(bare call)을 넣지 말 것 (현재 정의만 있고 자동호출 없음 = 올바른 상태).
- 관리자 판별 = `ADMIN_NAMES = ['Clara','Dennis']`. 관리자 전용 UI는 이 배열로 게이팅.
- GAS는 `FB_AUTH`의 DB secret으로 규칙을 통과한다 (위 4개 fb 함수 경유).

## 5. 데이터 모델 (가장 중요 — 키 규칙을 모르면 멀티룸/수정이 다 깨진다)
### 객실 상태
`need_clean` → `cleaning` → `clean_done` → `checkin` → `checkout_confirm` → `checkout_done`
- **`vacant`는 유효한 상태가 아니다.** 절대 도입하지 말 것.

### 예약 키 규칙 (`app/` 하위)
- **단일룸 예약** = 기존 `sv_{bookingId}` 키를 그대로 유지.
- **멀티룸 예약** = `sv_<원본bookingId>_<RoomName>` 형태로 룸별로 분할 저장.
- **수정(amendment)** = replace 방식. 해당 bookingId의 레코드를 **전부 삭제한 뒤 재작성**한다 (부분 갱신 아님).
- **표시는 `assignedRoom`, 식별은 `bookingId`.** 이 둘을 혼동하지 말 것.

### 게스트 메일 동작 규칙
- 템플릿 저장 위치: `app/mailTemplates/*` (s1~s6 + s34_combined 등).
- **신포맷 필드 `bodyKo`/`bodyEn`가 있으면 구버전 `body` 필드는 사용되지 않는다.** 발송 로직이 신포맷을 우선한다.
- 본문 포맷: ■대제목 / ──구분선 / ▶섹션 / ▷하위 / ●입실 ○퇴실 / ✶영문안내.
- **컬러·4바이트(이모지 등) 문자는 GmailApp에서 깨진다. BMP 범위 기호만 사용한다.**
- **중복발송 방지 가드 있음**: `mailLogs` 기반 dedupe로, 같은 예약 + 같은 단계는 재발송이 막힌다. "발송이 왜 안 되지?"의 흔한 원인이니, 의도적 재발송이 필요하면 이 가드를 먼저 확인할 것.

## 6. GAS 구조 및 배포
- 진입점: `doPost` = SIRVOY webhook 수신 → 예약 레코드 생성/수정(위 키 규칙 적용).
- Firebase 접근: `fbGet / fbSet / fbUpdate / fbDelete` 4함수만 사용 (auth 자동 부착).
- 스케줄 트리거: 5분 주기 `masterTick`, 일일 `t1100 / t1159 / t1200`, 매시간 `autoCheckinTick`.
  - `autoCheckinTick`: **21:00 이후**(코드상 `if(min<1260)return;` — 하한만 있고 상한 가드는 없음) **+ "오늘 체크인" 날짜 조건**이 맞는 객실 중, 입실안내 발송완료된 `clean_done` 객실을 `checkin`으로 전환. (자정 이후엔 날짜 조건이 자연히 안 맞아 결과적으로 안 돈다 — 상한 가드가 있는 게 아니다.)
- **GAS 수정 후에는 반드시 "배포 관리 → 새 버전 → 배포"를 해야 반영된다.** `doGet/doPost`는 *배포된 버전*이 돌기 때문에, 코드만 고치고 배포 안 하면 "고쳤는데 왜 그대로지?"로 시간을 날린다. 단, **트리거 함수와 Firebase 템플릿 변경은 배포와 무관**하게 즉시 반영된다.

## 7. 절대 금지 (DO NOT)
- **`seedTemplatesV3()` 절대 실행 금지.** 실행하면 Firebase에 신포맷(bodyKo/bodyEn)으로 재작성해 둔 메일 템플릿이 전부 구버전으로 덮여 날아간다.
- 평문 비밀번호 / Firebase DB secret / GitHub 토큰을 **코드나 이 문서에 넣지 말 것.** GitHub에 커밋되면 노출된다.
- `vacant` 상태 도입 금지 (§5).
- 로그인 완료 전 데이터 읽기 호출 금지 (§4).

## 8. 탭 구성
객실 - 예약 - 발송 - 배정 - 업무일지 - 비품

## 9. 범위 밖 (이 repo가 아닌 것)
- **CS 엔진**(OTA 메시지 라우팅·답장)은 이 repo의 GAS/프론트에 **구현되어 있지 않다.** 현재 코드는 `app/*` 네임스페이스만 사용하며 `cs/*` 참조가 없다. CS는 별도 시스템/예정이며, 관련 데이터는 CS DB 스프레드시트(`1JHbIEJ9XX1Pxp0JPPgQmJ-1xWI7e5fKtrws4x-iCcJg`)에 있다. **다음 세션은 이 repo에서 `cs/*`를 찾지 말 것.**

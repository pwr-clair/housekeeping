# CLAUDE.md — Paradise Walk Residence Housekeeping Dashboard

> 이 문서의 목적: 어떤 세션이든 이 repo를 처음 열어도, **이 문서만 읽으면 시스템을 깨뜨리지 않고 작업할 수 있는** 불변의 베이스. 변동성 있는 TODO/진행상황은 여기 적지 않는다 (그건 코드·이슈·세션 메모로 관리).
> **정본 = pwr-clair/pwr-docs/PWR_MASTER.md (비공개).** 이 문서와 충돌하면 마스터가 우선한다. 이 CLAUDE.md는 HK 레포 로컬 불변 베이스이고, 시스템 전역 상태·최신 결정은 마스터에서 확인한다.

## ⚡ 열쇠 프로토콜 (2026-07-12 확립 — 최우선, 이 문서의 다른 내용보다 우선)
- 클라라가 **`0917`** 입력 → **시작 리추얼**: ①pwr-clair/pwr-docs를 스크래치패드에 clone(최신, keychain 인증) ②Notion 미러(페이지 "PWR_MASTER", page_id 397b9d1f-a416-81f8-8e12-eeccfdefc21b) 헤더 "최종 갱신"과 레포 헤더 비교 → **더 최신인 쪽을 정본으로 양쪽 동기화**(역동기화 포함) ③PWR_MASTER 기준 현재 상태·B1 다음 액션·오늘 아젠다 브리핑 후 대기.
- 클라라가 **"오늘은 여기까지"** 입력 → **마감 리추얼 한 세트**: ①PWR_MASTER Part B 제자리 갱신(헤더 최종 갱신 시각 필수) ②pwr-docs/status-board.html DATA 블록 갱신 ③`~/Documents/status-board.html` 복사 ④pwr-docs 커밋·푸시+HEAD==origin 확인 ⑤Notion 미러 동기화 ⑥완료 보고(증거 포함).

---

## 1. 시스템 개요
인천공항 인근 무인 단기임대 "Paradise Walk Residence"의 하우스키핑 운영 대시보드. (객실 수는 고정이 아니라 화면에서 추가/삭제 가능 — §5 객실 모듈 참고.)
- repo: `pwr-clair/housekeeping` · **앱 서빙 = Firebase Hosting `https://paradise-walk-residence.web.app`** (2026-09-30 이전 완료)
- **GitHub이 단일 진실 공급원(source of truth).** 작업 컨테이너는 세션마다 초기화되므로, 모든 작업은 GitHub 최신본을 읽는 것에서 시작한다.

## 2. 세션 시작 절차 (필수)
1. **로컬 HK 폴더(`/Users/ClairCho/Documents/housekeeping`)를 origin/main 최신본과 동기화한다** (클코 keychain 인증으로 git pull/clone). 로컬 사본이 낡아있을 수 있어 옛 버전 위에 덮어쓰지 않도록 최신화가 선행 조건. GAS `Code.gs`는 레포에 없으면 GAS 에디터가 정본.
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
  [index.html  단일 파일 / Firebase Hosting]  ← 운영자 대시보드
```

- **프론트(index.html)**: 단일 HTML 파일. Firebase를 직접 실시간 구독/쓰기. 모든 UI가 이 한 파일 안에 있다. 홈화면 아이콘(apple-touch-icon)도 base64로 이 파일에 내장돼 있어 `logos/`는 서빙 대상이 아니다(원본 보관용).
- **★★ 앱 서빙 = Firebase Hosting. `index.html`을 고쳤으면 `sh tools/deploy-site.sh`를 돌려야 라이브에 반영된다.**
  **커밋·push만으로는 아무 일도 일어나지 않는다.** 옛 GitHub Pages 자동반영 시절의 감각으로 커밋만 하고 끝내면,
  코드는 고쳐졌는데 운영자 화면은 그대로여서 "고쳤는데 왜 안 돼"로 시간을 날린다.
  - 실제 사고 2026-10-01: 폰(클라우드) 세션이 이동 복제 수리를 커밋만 하고 끝냈고, 배포가 안 된 줄 모른 채
    운영자가 복제분을 지우다 **예약이 통째로 소실**됐다(옛 코드의 '같은 예약 전부 삭제'가 돌았다).
  - **폰·클라우드 세션은 배포를 할 수 없다** — 배포 자격증명(`~/.config/configstore/firebase-tools.json`,
    `~/.clasprc.json`)이 클라라 맥에만 있다. 폰에서 작업했으면 **맥에서 배포 한 번**이 반드시 뒤따라야 하고,
    세션 끝에 그 사실을 운영자에게 알릴 것.
  - 옛 주소 `https://pwr-clair.github.io/housekeeping/`는 이제 **"새 주소로 가세요" 안내 페이지**다
    (Pages 소스 = `pages-notice` 가지). 앱이 아니다.
- **GAS(Code.gs)**: SIRVOY webhook 수신(`doPost`), 게스트 메일 자동화, 스케줄 기반 객실 상태 전환. Firebase 접근은 `fbGet/fbSet/fbUpdate/fbDelete` 4개 함수로만 하며, 이들이 `?auth=` (DB secret in `FB_AUTH`)를 자동 부착한다.
- **네임스페이스**: 이 repo의 GAS·프론트는 **`app/*`만 사용한다.** (`cs/*` 같은 CS 엔진 네임스페이스는 이 코드에 존재하지 않음 — 아래 §9 참고.)
- HK GAS = PWR-HK-Engine (구 ParadiseWalk-CS, 2026-07-04 개명). CS GAS = PWR-CS-Engine. 과거 문서에 ParadiseWalk-CS로 표기된 것은 전부 HK 쪽을 가리킴.

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

### 객실 목록 = 동적 (하드코딩 아님)
- 객실 목록의 단일 출처 = **`app/rooms`의 키.** 코드에 객실 번호 배열을 하드코딩하지 않는다.
  - 프론트: `roomNums()` = `Object.keys(rooms)` 정렬. GAS: `roomNums()` = `Object.keys(fbGet('app/rooms'))` 정렬 (단, 함수가 이미 rooms를 읽으면 `Object.keys(rooms)` 재사용).
- 층(floor) 그룹도 동적: `floorOf(num)`(3자리=앞1, 4자리=앞2) → `floorGroups()`로 묶음. 층 칸 HTML도 `renderRooms`가 자동 생성. **새 층의 방을 추가하면 층 칸이 번호 순서에 맞게 자동 신설된다.**
- 객실 추가/삭제 UI = 관리자(§4) 전용. 담당자 모달(상단 이름칩) 안의 "객실 관리" 버튼.

### 정비중(blocked) / 운영예정일(operatingFrom)
- 새 객실은 **`blocked:true`(정비중)로 생성** → 운영 준비되면 운영자가 정비중 해제. GAS 발송·전환 함수는 `if(r.blocked)continue`로 정비중 방을 건너뛴다.
- `operatingFrom`(YYYY-MM-DD): 정비중 객실의 운영 시작 예정일. 배정탭 캘린더에서 그 날짜 **전**까지는 회색 빗금(막힌 칸), 그 날부터 정상. 미설정이면 계속 회색.

### 예약 금액 (amount)
- `app/pendingBookings/{key}/amount` = 예약 금액(원, 정수). **SIRVOY가 webhook으로는 금액을 안 보냄** → GAS `syncAmounts()`가 Gmail의 SIRVOY 알림메일("Booking N Added to Sirvoy", 라벨 `sirvoy booking alert`)에서 `Total` 추출해 채운다. `masterTick`에서 주기 실행.
- 미배정 예약 목록(배정탭)의 손님 이름 옆에 `₩금액` 표시. (배정 후 currentBooking에는 금액을 흘려보내지 않음 — 미배정 목록에서만 표시.)

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

## 6-1. 앱 배포 — Firebase Hosting (2026-09-30 이전 완료)

**현재 상태**: 이전 완료. 앱은 `https://paradise-walk-residence.web.app`에서 서빙된다.

**배포 방법**: `sh tools/deploy-site.sh` — 회귀검사 통과 시에만 `site/`를 구성해 올린다.

**★ `firebase.json`의 `"public"`을 절대 `"."`로 바꾸지 말 것.** 루트를 통째로 올리면 이 문서와
`gas/Code.gs`·`tools/`가 전부 웹에 공개된다. 서빙 대상은 `tools/deploy-site.sh`의 `SERVE`
화이트리스트(`index.html manual.html`)뿐이다. 회귀검사 [11]이 이걸 지킨다.

**아직 안 끝난 것**:
- 레포 비공개 전환 — 스텝 폰 바로가기가 전부 새 주소로 바뀐 뒤에.
- 비공개로 가면 `selfUpdate`(§6)가 죽는다 — `raw.githubusercontent.com`을 익명으로 읽는 구조.
  clasp가 그 역할을 대체하므로 `selfUpdate` 폐지 또는 경로 교체를 먼저 정할 것.
- `cs` 레포도 같은 처리 필요 — 게스트에게 나가는 셔틀 지도 이미지가 그 레포에 있어 지금 잠그면 링크가 죽는다.


## 6. GAS 구조 및 배포
- GAS 프로젝트명: PWR-HK-Engine (구 ParadiseWalk-CS, 2026-07-04 개명)
- 진입점: `doPost` = SIRVOY webhook 수신 → 예약 레코드 생성/수정(위 키 규칙 적용).
- Firebase 접근: `fbGet / fbSet / fbUpdate / fbDelete` 4함수만 사용 (auth 자동 부착).
- 스케줄 트리거: 5분 주기 `masterTick`(s2/s3/s4/s5/s6 발송 타이밍 + `syncAmounts` 금액 동기화 포함), 일일 `t1100 / t1159 / t1200`. **`autoCheckinTick`은 2026-09-18 클라라 지시로 폐지**(함수 본체 비움, `setupTriggers()`에서 제외 — 에디터 트리거 목록에는 아직 남아 있으나 no-op).
  - 자동발송 시각·템플릿은 운영자가 발송탭에서 조정: `app/mailConfig/auto/{stage}` = `{time:'HH:MM', template:'custom_*'}` (2026-07-25). 미설정이면 코드 기본 시각(s2 07:00 / s5 11:05 / s6 12:30 / s4 21:00)·단계 기본 템플릿. on/off는 기존 `app/mailConfig/stages`. s3(입실)은 체크인 시각 연동이라 이 설정 대상 아님.
  - `autoCheckinTick`(폐지): 예전엔 21:00 이후 매시간, 오늘 체크인 + 입실안내 발송완료된 `clean_done` 객실을 `checkin`으로 자동 전환했다. 사람이 객실 상태를 확인하기 전에 전부 '입실중'이 돼버려 폐지. 되돌리기는 `revertAutoCheckin(date)`. **이 폐지는 옆 브랜치에만 있어 main 전문 배포 때마다 3번 되살아났다 — 되살리지 말 것.**
- **GAS 수정 후에는 반드시 "배포 관리 → 새 버전 → 배포"를 해야 반영된다.** `doGet/doPost`는 *배포된 버전*이 돌기 때문에, 코드만 고치고 배포 안 하면 "고쳤는데 왜 그대로지?"로 시간을 날린다. 단, **트리거 함수와 Firebase 템플릿 변경은 배포와 무관**하게 즉시 반영된다.
- **GAS 정본 버전관리 (2026-07-14 시작): HK GAS 소스 = 이 레포 `gas/Code.gs`.** 수정은 레포에서 하고, 클라라에게는 raw URL 한 줄로 전달: `https://raw.githubusercontent.com/pwr-clair/housekeeping/main/gas/Code.gs`
- **클라라 복붙 반영물 전달 규칙 (2026-07-14 클라라 지시)**: 복붙 반영해야 하는 코드·텍스트는 ①채팅에 바로 복붙 가능하게 주거나 ②정확한 원클릭 URL만 줄 것. "레포 가서 파일 열고 복사해서…" 식 다단계 안내 금지. 배포 절차는 클라라가 숙지 — "배포까지 하세요" 한 줄이면 충분.
- **GAS 코드 전문을 줄 때는 GAS 에디터 링크를 반드시 세트로 같이 줄 것 (2026-08-25 클라라 지시).** 붙여넣을 곳 없이 코드만 주지 말 것. **에디터 원클릭(2026-09-30 클라라 제공): https://script.google.com/home/projects/1Has2BDgsRrsE-pfvnJbnleYo8PP3-pnymFE5zX3_IVymyz6uQp5vJAuv/edit** — script ID `1Has2BDgsRrsE-pfvnJbnleYo8PP3-pnymFE5zX3_IVymyz6uQp5vJAuv` (clasp 용).
- **★ main 전문을 GAS에 붙여넣기 전에 `sh tools/branch-audit.sh`를 반드시 실행할 것 (2026-09-21 신설).** 원격 세션들이 각자 브랜치에 커밋하고 main에 안 올린 채 끝나는 일이 반복됐고, 그 상태에서 main 전문을 배포하면 옆 브랜치의 수정이 통째로 덮여 사라진다. 실제 사고 3건: 725dd6c(금액 자동수집 정지)·e446102(딜레이 메시지 전멸)·004e586(21시 자동입실 폐지가 되살아남). 커밋이 없다고 빠진 게 아니라 **코드 내용으로** 판단할 것 — 나중에 재구현된 경우도 있다.
- **BCC는 끈 상태가 기본이다 (2026-10-01 클라라 결정).** 발송 기록은 `app/mailLogs`에 건건이
  남으므로(수신자·시각·단계·방) 메일함 사본은 불필요하고, 켜면 할당량만 두 배로 먹는다.
  `setBcc`로 되살리지 말 것 — 클라라가 명시적으로 요청할 때만.
- **★ 발송 '성공' 기록이 게스트 수신을 보장하지 않는다 (사고 2026-10-01).**
  633호 Marion, Lery의 주소가 `cs_suppliers@agoda.com`(아고다 공급사 지원팀)이었다. Gmail은 정상
  발송했고 `app/mailLogs`에도 성공으로 남았지만 **게스트 채팅창에는 안 들어갔다.** 운영자가 아고다
  채팅창을 직접 열어보기 전까지 아무도 몰랐다. 정상 게스트 릴레이 주소는 채널별로 형태가 정해져 있다:
  Agoda `영숫자@agoda-messaging.com` · Booking.com `이름.숫자@guest.booking.com`.
  점검은 `checkGuestMails` — 다만 현재는 키워드 대조라 **모르는 형태는 못 잡는다**(채널별 형태 검증으로
  강화 예정).
- **★ Gmail 하루 할당량은 '메일 수'가 아니라 '수신자 수'로 센다 — BCC도 1명이다 (사고 2026-10-01).**
  일반 Gmail 계정은 하루 100 수신자. BCC(`app/config/bccEmail`)가 켜져 있으면 **게스트 1통당 2를 소모**해
  용량이 절반이 된다. 10-01에 54통을 보내고 ≈108 수신자로 한도를 넘겨 "하루에 email 서비스를 너무 많이
  호출했습니다"로 **입실안내 자동발송이 전부 막혔다**. 급할 때는 에디터에서 `clearBcc` 실행 → 즉시 절반 확보,
  되돌리기는 `setBcc`. 진단은 `quotaAndPrep`(보낸편지함 제목별 집계 포함), 실측은 `testSend`.
- **`appsscript.json`에 `https://www.googleapis.com/auth/script.send_mail`이 없다.** 그래서
  `MailApp.getRemainingDailyQuota()`가 권한 예외로 실패해 남은 할당량을 숫자로 못 읽는다.
  추가하면 **재승인이 필요하고 재승인 전까지 시간 트리거가 멈출 수 있으므로**, 발송 시간대를 피해 작업할 것.
- **관리자 오류 알림은 하루 1통으로 제한된다(`notifyAdmin_`, 2026-10-01).** 예전엔 자동발송이 실패하면
  lastRun 도장이 안 찍혀 5분 틱마다 재시도하며 그때마다 오류 메일이 나갔다(한 단계당 하루 24통).
  지금은 같은 키당 하루 1통만 보내고 나머지는 `app/autoSend/errors/{날짜}`에 쌓인다. 할당량이 5통 미만이면
  알림 자체를 생략해 남은 건 전부 게스트 몫으로 돌린다.
- **지금 GAS에 붙어 있는 코드 버전 확인: 에디터에서 `codeVersion` 실행.** `CODE_VER` 상수를 로그로 찍는다. 붙여넣기·재배포 여부를 추측하지 말 것. 커밋할 때 `CODE_VER`도 같이 갱신한다.

## 7. 절대 금지 (DO NOT)
- **`seedTemplatesV3()` 절대 실행 금지.** 실행하면 Firebase에 신포맷(bodyKo/bodyEn)으로 재작성해 둔 메일 템플릿이 전부 구버전으로 덮여 날아간다.
- 평문 비밀번호 / Firebase DB secret / GitHub 토큰을 **코드나 이 문서에 넣지 말 것.** GitHub에 커밋되면 노출된다.
- `vacant` 상태 도입 금지 (§5).
- 로그인 완료 전 데이터 읽기 호출 금지 (§4).

## 8. 탭 구성
객실 - 예약 - 발송 - 배정 - 업무일지 - 비품

## 9. 범위 밖 (이 repo가 아닌 것)
- **CS 엔진**(OTA 메시지 라우팅·답장)은 이 repo의 GAS/프론트에 **구현되어 있지 않다.** 현재 코드는 `app/*` 네임스페이스만 사용하며 `cs/*` 참조가 없다. CS는 별도 시스템/예정이며, 관련 데이터는 CS DB 스프레드시트(`1JHbIEJ9XX1Pxp0JPPgQmJ-1xWI7e5fKtrws4x-iCcJg`)에 있다. **다음 세션은 이 repo에서 `cs/*`를 찾지 말 것.**

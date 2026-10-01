#!/bin/sh
# ============================================================
# 회귀 전수 검사 (2026-09-30 신설) — 배포·복붙 전 필수 실행
# 지금까지 실제로 터졌던 사고 전부를 '코드 내용' 기준으로 검사한다.
# 커밋 이력은 안 본다 — 재작업·복붙으로 커밋 없이 코드만 되돌아간 회귀를 잡기 위함.
# 새 사고가 터져 수리할 때마다 여기 검사 하나를 추가할 것 (사고 1건 = 검사 1건).
# 사용: sh tools/regression-check.sh   (branch-audit.sh가 자동으로 호출한다)
# ============================================================
cd "$(dirname "$0")/.." || exit 1
FAIL=0
ok(){ echo "  ✅ $1"; }
bad(){ echo "  ★★ 회귀: $1"; FAIL=$((FAIL+1)); }

echo "── 회귀 전수 검사 (사고 이력 기반) ──"

# [1] s5 방문고지 빈 제목 가드 (07-28 수리 → 08-01 재발 → 09-30 재수리, 3회째)
if grep -q '!tpl *|| *!tpl\.subject' gas/Code.gs; then
  bad "gas/Code.gs에 빈 제목 가드(!tpl||!tpl.subject) 재유입 — s5 템플릿은 subject=null이라 방문고지가 조용히 전멸한다. 가드 제거 전 배포 금지"
else ok "s5 빈 제목 가드 없음"; fi

# [2] 금액 자동수집 (사고 725dd6c 유실 — 금액 수집 정지)
if grep -q 'function syncAmounts' gas/Code.gs && grep -q 'syncAmounts()' gas/Code.gs; then
  ok "syncAmounts 존재+호출"
else bad "gas/Code.gs에서 syncAmounts(금액 자동수집)가 사라졌거나 masterTick에서 호출이 빠졌다 (사고 725dd6c 재발)"; fi

# [3] 딜레이(늦은 객실준비) 안내 (사고 e446102 유실 — 딜레이 메시지 전멸)
if grep -q 'latePrepTick_' gas/Code.gs; then
  ok "latePrepTick_(지연 안내) 존재"
else bad "gas/Code.gs에서 latePrepTick_(늦은 객실준비 안내)가 사라졌다 (사고 e446102 재발)"; fi

# [4] 두 번째 게스트 이메일 동봉 (2026-09-05 클라라 지시 — notes 속 이메일 다중 수신)
if grep -q 'bk&&bk.notes' gas/Code.gs || grep -q 'notes)||.*match' gas/Code.gs; then
  ok "guestRecipients_ notes 이메일 동봉 유지"
else bad "gas/Code.gs guestRecipients_에서 특이사항(notes) 이메일 동봉이 사라졌다 — 직거래 2인 예약 두 번째 게스트가 메일을 못 받는다"; fi

# [5] 비품 완료 항목 보존 (사고 2026-08-02 — 모달 저장 시 완료 비품 전삭제)
if grep -q 'v.done)obj\[k\]=v' index.html; then
  ok "비품 완료 항목 보존 로직 유지"
else bad "index.html saveRoomSupplies에서 완료 비품 보존이 사라졌다 — 모달 저장만 해도 체크 완료 비품이 전부 삭제된다 (사고 2026-08-02 재발)"; fi

# [6] vacant 상태 금지 (CLAUDE.md §5)
if grep -q "'vacant'" index.html gas/Code.gs 2>/dev/null; then
  bad "vacant 상태가 코드에 등장 — 유효한 상태가 아니다 (CLAUDE.md §5 절대 금지)"
else ok "vacant 미도입"; fi

# [7] initFirebaseData 자동실행 금지 (CLAUDE.md §4 — 로그인 전 데이터 읽기 = 화면 안 뜸)
N=$(grep -c 'initFirebaseData' index.html)
if [ "$N" -le 1 ]; then ok "initFirebaseData 정의만 존재(자동호출 없음)";
else bad "initFirebaseData 참조가 ${N}곳 — 정의 외 호출이 생겼다. 로그인 전 실행이면 규칙에 막혀 화면이 깨진다 (CLAUDE.md §4)"; fi

# [8] seedTemplatesV3 부활 금지 (실행 시 신포맷 템플릿 전멸 — CLAUDE.md §7)
if grep -q 'seedTemplatesV3' gas/Code.gs 2>/dev/null; then
  bad "seedTemplatesV3가 gas/Code.gs에 다시 들어있다 — 실행되면 메일 템플릿이 구버전으로 전멸한다 (CLAUDE.md §7)"
else ok "seedTemplatesV3 없음"; fi

# [9] CODE_VER 스탬프 (복붙 반영본 식별용 — 없으면 배포 추적 불능)
if grep -q "var CODE_VER" gas/Code.gs; then ok "CODE_VER 존재";
else bad "gas/Code.gs에 CODE_VER가 없다 — 어떤 버전이 GAS에 붙었는지 식별 불능"; fi

# [10] 자동발송 도장 방식 (07-29 수리 — 10분 창은 트리거 몇 분 밀리면 그날 발송 통삭제)
if grep -q 'autoSend/lastRun' gas/Code.gs; then ok "자동발송 도장(lastRun) 방식 유지";
else bad "gas/Code.gs 자동발송이 도장(autoSend/lastRun) 방식이 아니다 — 10분 창 방식이면 트리거 밀림에 그날 발송이 통째로 날아간다 (07-29 사고 재발)"; fi

echo

# [11] firebase.json public 경로 (사고 2026-09-30 — 레포 비공개화로 앱 20분 다운, 이전 준비 중)
if [ -f firebase.json ]; then
  if grep -qE '"public"[[:space:]]*:[[:space:]]*"\.?"' firebase.json; then
    bad "firebase.json의 public이 레포 루트다 — 배포하면 CLAUDE.md·gas/Code.gs·tools/가 통째로 웹에 공개된다. \"site\"로 되돌릴 것"
  else ok "firebase.json public=site (루트 유출 없음)"; fi
fi

# [12] 예약 삭제가 객실 상태를 무조건 덮는 회귀 (사고 2026-09-30 — 920호 노쇼)
# deleteCurrentBooking이 status:'need_clean'을 조건 없이 쓰면, 청소완료된 방의 예약을
# 지우기만 해도 청소가 되살아난다. 2026-07-15 정오이동 수리와 같은 함정의 두 번째 사례.
# 보호 장치(keep 가드)가 있는지를 본다 — else 분기의 need_clean은 정상이므로 그걸로 판정하면 오탐이 난다.
if grep -q "\['cleaning','clean_done'\].includes(r0.status)" index.html; then
  ok "예약 삭제 시 청소 상태 보존(keep 가드 있음)"
else bad "deleteCurrentBooking에 상태 보존 가드가 없다 — 청소완료된 방의 예약을 지우기만 해도 청소가 되살아난다 (사고 2026-09-30 재발)"; fi

# [13] 노쇼 처리가 발송 원본을 취소 표시하는지 (사고 2026-09-30 — 노쇼에게 메일 발송)
if grep -q "markNoShow" index.html && grep -q "cancelled:true" index.html; then
  ok "노쇼 처리가 발송 원본에 cancelled 표시"
else bad "노쇼 처리가 pendingBookings에 cancelled를 안 찍는다 — 오지 않은 손님에게 퇴실안내·후기요청이 계속 나간다"; fi

# [14] 취소 웹훅이 객실 배정까지 반영하는지 (사고 2026-10-01 — 취소분이 자리를 차지)
if grep -q "removeBookingFromRooms_" gas/Code.gs; then
  ok "취소 시 객실 배정 자동 제거"
else bad "취소 웹훅이 pendingBookings에만 도장을 찍고 객실은 안 건드린다 — 없어진 예약이 자리를 차지한다 (사고 2026-10-01 재발)"; fi

# [15] 게스트에게 안 닿는 주소를 발송 대상에서 거르는지 (사고 2026-10-01 — 633호 cs_suppliers@agoda.com)
if grep -q "badGuestMailReason_" gas/Code.gs && grep -q "badGuestMailReason" index.html; then
  ok "비게스트 주소 차단(GAS·프론트 양쪽)"
else bad "비게스트 주소 판별이 GAS나 프론트에서 빠졌다 — 발송이 '성공'으로 기록되는데 게스트는 못 받는다 (사고 2026-10-01 재발)"; fi

# [16] 취소 반영이 청소 상태를 건드리지 않는지 (920호 사고 교훈)
if grep -q "fbUpdate('app/rooms/' + num, upd);   // status는 포함하지 않는다" gas/Code.gs; then
  ok "취소 반영이 청소 상태를 보존"
else bad "removeBookingFromRooms_가 status를 함께 쓰고 있을 수 있다 — 예약 제거로 청소가 되살아난다 (920호 사고 재발)"; fi

# [17] 죽은 selfUpdate가 되살아났는지 (2026-10-01 폐지 — 자동배포가 대체, 비공개 전환 시 작동 불가)
if grep -q "SELF_UPDATE_URL\|function selfUpdate" gas/Code.gs; then
  bad "selfUpdate가 되살아났다 — raw.githubusercontent.com 익명 읽기라 레포 비공개 시 죽는다. 자동배포(.github/workflows/deploy.yml)가 대체한다"
else ok "selfUpdate 폐지 유지"; fi

# [18] 메일 막힘 감지·배너 (사고 2026-10-01 — 할당량 소진이 아무 표시 없이 지나갔다)
if grep -q "mailBlocked" gas/Code.gs && grep -q "mail-blocked-banner" index.html; then
  ok "메일 막힘 감지+배너"
else bad "메일 막힘 깃발(app/autoSend/mailBlocked)이나 배너가 빠졌다 — 할당량이 바닥나도 운영자가 모른다"; fi

# [19] PWA 파일이 서빙 목록에 있는지 (빠지면 알림만 조용히 죽는다 — 앱은 멀쩡해 눈치채기 어렵다)
_serve=$(sed -n 's/^SERVE="\(.*\)"$/\1/p' tools/deploy-site.sh)
_miss=""
for _f in manifest.json firebase-messaging-sw.js icon-192.png icon-512.png; do
  case " $_serve " in *" $_f "*) ;; *) _miss="$_miss $_f";; esac
  [ -f "$_f" ] || _miss="$_miss $_f(파일없음)"
done
if [ -z "$_miss" ]; then ok "PWA 파일 서빙 목록 포함"
else bad "서빙 목록(SERVE)이나 레포에서 빠진 PWA 파일:$_miss — 알림이 조용히 안 온다"; fi

# [20] 서비스워커 파일명 고정 (Firebase Messaging이 루트의 이 이름을 찾는다)
if [ -f firebase-messaging-sw.js ] && grep -q "onBackgroundMessage" firebase-messaging-sw.js; then
  ok "서비스워커 존재+배경 수신 처리"
else bad "firebase-messaging-sw.js가 없거나 onBackgroundMessage가 빠졌다 — 앱 꺼진 상태 알림 불가"; fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 회귀 검사 전 항목 통과 (${FAIL} 실패)"
else
  echo "★★★ 회귀 ${FAIL}건 감지 — 이대로 배포하면 과거 사고가 재발한다. 위 항목부터 수리할 것."
  exit 1
fi

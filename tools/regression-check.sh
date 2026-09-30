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

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 회귀 검사 전 항목 통과 (${FAIL} 실패)"
else
  echo "★★★ 회귀 ${FAIL}건 감지 — 이대로 배포하면 과거 사고가 재발한다. 위 항목부터 수리할 것."
  exit 1
fi

#!/bin/sh
# ============================================================
# GAS 배포 — clasp (2026-09-30 신설)
# 사용: sh tools/deploy-gas.sh "배포 설명"
#
# 이걸로 에디터 복붙이 필요 없어진다. 레포 gas/Code.gs가 곧 라이브다.
#
# ★ 기존 배포 ID를 그대로 갱신한다(-i). 새 배포를 만들면 웹앱 URL이 바뀌어
#   SIRVOY 웹훅이 끊긴다. WEBHOOK_DEPLOY_ID를 바꾸지 말 것.
# ============================================================
cd "$(dirname "$0")/.." || exit 1
WEBHOOK_DEPLOY_ID='AKfycbz0cmhe3lT-xPlFgHLH5b2aun0plBljkK-1aNB_40f7tYYxbcfu64bwlLomVtpVqtwc'
DESC="${1:-$(git log -1 --pretty=%s | cut -c1-90)}"

echo "── 배포 전 검사 ──"
sh tools/branch-audit.sh || { echo "배포 중단 — 검사 실패"; exit 1; }

echo
echo "── 현재 CODE_VER ──"
grep -m1 "var CODE_VER" gas/Code.gs
echo "  (바꿨어야 하는데 그대로면 지금 중단하고 갱신할 것)"

echo
echo "── 코드 올리기 ──"
npx --yes @google/clasp push --force || exit 1

echo
echo "── 배포(웹훅 URL 유지) ──"
npx --yes @google/clasp deploy -i "$WEBHOOK_DEPLOY_ID" -d "$DESC" || exit 1

echo
echo "✅ 완료. 반영 확인: 에디터에서 codeVersion 실행 또는"
echo "   npx @google/clasp deployments"

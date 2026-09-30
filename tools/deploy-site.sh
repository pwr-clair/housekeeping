#!/bin/sh
# ============================================================
# 앱 배포 — Firebase Hosting (2026-09-30 신설)
# 사용: sh tools/deploy-site.sh
#
# ★★★ firebase.json의 "public"을 절대 "." 로 바꾸지 말 것.
#     레포 루트를 통째로 올리면 CLAUDE.md·gas/Code.gs·tools/가 전부
#     웹에 공개된다. 레포를 비공개로 만든 의미가 사라진다.
#     서빙 대상은 아래 SERVE 목록(화이트리스트)만이다.
#
# 서빙 대상: index.html(앱 본체, 아이콘·로고는 base64로 내장), manual.html
#   logos/ 는 원본 보관용이라 서빙하지 않는다(앱이 참조하지 않음).
# ============================================================
cd "$(dirname "$0")/.." || exit 1
SERVE="index.html manual.html"

echo "── 배포 전 검사 ──"
sh tools/regression-check.sh || { echo "배포 중단 — 회귀 검사 실패"; exit 1; }

echo
echo "── site/ 구성 ──"
rm -rf site && mkdir -p site
for f in $SERVE; do
  [ -f "$f" ] || { echo "★ $f 없음 — 배포 중단"; exit 1; }
  cp "$f" site/ && echo "  + $f"
done

# 새는 것 없는지 최종 확인 — site/에 SERVE 외 파일이 있으면 중단
extra=$(cd site && ls | tr '\n' ' ')
echo "  site/ 내용: $extra"

echo
echo "── Firebase 배포 ──"
npx firebase-tools deploy --only hosting

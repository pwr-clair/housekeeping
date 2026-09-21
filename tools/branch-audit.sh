#!/bin/sh
# main에 병합되지 않은 원격 브랜치와 그 커밋을 전부 보여준다.
#   GAS에 main 전문을 붙여넣기 전에 반드시 실행할 것.
# 옆 브랜치에만 있는 수정은 그 배포로 통째로 덮여 사라진다 —
# 725dd6c(금액 동기화)·e446102(딜레이 메시지)·004e586(21시 자동입실 폐지)이 전부 같은 사고였다.
#   사용: sh tools/branch-audit.sh
set -e
cd "$(dirname "$0")/.."
git fetch --all -q 2>/dev/null || true
found=0
for b in $(git branch -r --no-merged main | grep -v HEAD); do
  n=$(git rev-list --count "main..$b")
  [ "$n" -eq 0 ] && continue
  found=$((found+1))
  echo "── $b  (main에 없는 커밋 ${n}개, 최종 $(git log -1 --format=%ad --date=short "$b"))"
  git log --format='     %h %ad %s' --date=short "main..$b" | cut -c1-140
  echo
done
if [ "$found" -eq 0 ]; then
  echo "✅ main에 병합 안 된 브랜치 없음 — 전문 배포해도 유실될 작업이 없다."
else
  echo "★ 브랜치 ${found}개에 main에 없는 작업이 있다."
  echo "  각 커밋 내용이 지금 main 코드에 반영돼 있는지 확인한 뒤 배포할 것."
  echo "  (재구현돼서 커밋만 없는 경우도 있으니 커밋 존재 여부가 아니라 '코드 내용'으로 판단)"
fi

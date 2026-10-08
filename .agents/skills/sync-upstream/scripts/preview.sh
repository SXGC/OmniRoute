#!/usr/bin/env bash
# 只读预演：把 fork 分支同步到上游目标分支会有多少冲突。不改工作区、不改任何 ref。
# 用法: preview.sh [fork-branch] [target-ref]
#   默认 fork-branch=fork-master，target-ref=最高 semver 的 origin/release/v*
set -euo pipefail
FORK="${1:-fork-master}"
git fetch origin --quiet
TARGET="${2:-$(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/release/v*' | sort -V | tail -1)}"
BASE=$(git merge-base "$FORK" "$TARGET")

echo "fork:    $FORK  ($(git rev-parse --short "$FORK"))"
echo "target:  $TARGET  ($(git rev-parse --short "$TARGET"))"
echo "base:    $(git log --oneline -1 "$BASE")"
echo "fork 独有提交: $(git rev-list --count "$TARGET..$FORK")   上游新增提交: $(git rev-list --count "$FORK..$TARGET")"
echo
echo "== fork 提交"
git log --oneline "$TARGET..$FORK"
echo

TREE=$(git merge-tree --write-tree "$FORK" "$TARGET" 2>/dev/null | head -1 || true)
echo "== 文本冲突（文件 / 冲突块数）"
CONFLICTS=$(git merge-tree --write-tree --name-only --no-messages "$FORK" "$TARGET" | tail -n +2 || true)
if [ -z "$CONFLICTS" ]; then echo "(无)"; else
  for f in $CONFLICTS; do echo "$(git show "$TREE:$f" 2>/dev/null | grep -c '^<<<<<<<' || echo '?')  $f"; done
fi
echo

echo "== 隐性冲突：fork 在上游数字编号空间里新增的迁移（必须为空）"
git diff --name-only --diff-filter=A "$BASE" "$FORK" -- ':(glob)src/lib/db/migrations/*.sql' || true
echo "== 上游当前最高迁移编号"
git ls-tree --name-only "$TARGET" src/lib/db/migrations/ | grep -E '/[0-9]+_.*\.sql$' | sed 's#.*/##' | sort -V | tail -1
echo

echo "== .fork/seams.json 中仍 claimed 的 seam（逐个确认上游是否已提供同样行为）"
git show "$FORK:.fork/seams.json" 2>/dev/null | grep -E '"path"|"status"' || echo "(无 seams.json)"

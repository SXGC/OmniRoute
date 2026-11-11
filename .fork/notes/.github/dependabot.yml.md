# .github/dependabot.yml

kind: B · status: claimed · reason: Remove the upstream Dependabot config so the fork receives no automated dependency-update PRs.

## 改动

删除 `.github/dependabot.yml`。

## 原因

fork 已关闭全部 GitHub CI/CD（见 `.github/workflows` seam），依赖由合并上游时统一更新，不需要 Dependabot 在 fork 上自动开依赖更新 PR。

## 重做

合并上游时，`.github/dependabot.yml` 出现 modify/delete 冲突一律保留删除（`git rm .github/dependabot.yml`）；上游重新新增该文件时同样删除。

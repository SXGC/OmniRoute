# .github/workflows

kind: B · status: claimed · reason: Remove every upstream GitHub Actions workflow so the fork runs no CI/CD.

## 改动

删除整个 `.github/workflows/` 目录（上游的全部 36 个 workflow 文件）。GitHub 仓库 SXGC/OmniRoute 的 Actions 也已在仓库设置中关闭（`actions/permissions` → `enabled=false`）。

## 原因

上游 workflow 依赖上游的 secrets、runner、发布目标和 release 分支约定，在 fork 中每次 push 都会失败（CI、Quality Gates、Docker 多架构构建、Wiki 同步等），只产生失败通知。fork 不需要任何 GitHub CI/CD。

## 重做

合并上游时，`.github/workflows/` 下出现的 modify/delete 冲突一律保留删除（`git rm`）；上游新增的 workflow 文件也一并 `git rm`。合并完成后确认 `git ls-files .github/workflows` 为空。不要删除 `scripts/check/check-workflows.mjs` 等脚本，它们只在 CI 中运行，保留可以减少与上游的冲突。

---
name: sync-upstream
description: 把本 fork 的 fork-master 分支 rebase 到上游 diegosouzapw/OmniRoute 最新的 release/v* 分支。用户说「同步上游」「sync upstream」「fork-master 跟上 upstream」「看看同步有多少冲突」时使用；只想预估冲突时只跑第 1–2 步。
---

# 同步上游到 fork-master

fork-master 是在上游 release 线上叠加少量 fork 提交的分支。同步方式是 **rebase**：fork 提交始终排在上游之上，历史保持线性。

## 0. 硬约束（先读）

- **永远不要 `git stash` / `git stash pop`**。stash 栈由所有 worktree 共享，会弄丢其他会话的改动。需要临时搁置改动时，用 WIP 提交。派出的子代理如果会碰 git，必须把这条原样写进它的 prompt。
- 只在 `.claude/worktrees/fork-master` 里操作，不要在主 checkout 里切分支，也不要碰别人的 worktree（先跑 `git worktree list` 确认）。
- 提交信息里不要写 AI 署名（`Co-Authored-By: Claude…`、"Generated with…"）。commit-msg 钩子会拒绝这种提交（Hard Rule #16）；钩子失败时，lint-staged 可能把暂存区恢复成旧内容，重新提交前要再核对一遍暂存的文件内容。
- `origin` 指向上游 diegosouzapw/OmniRoute。**不要推送到 origin**。是否推送、推到哪个远端，要先问用户；rebase 之后需要 `--force-with-lease`。

## 1. 确定目标分支

- 目标是 **semver 最高的 `origin/release/v*`**（本地 `master` 跟踪的就是它），**不是 `origin/main`**。fork 是从 release 线切出来的，和 main 比会冒出上千个“冲突”，没有参考价值。
- 如果用户说的“upstream master”有歧义，就用 `git branch -vv` 查看 `master` 跟踪的是哪个远端分支，以它为准。

## 2. 只读预演

```bash
bash .agents/skills/sync-upstream/scripts/preview.sh            # 默认 fork-master → 最高 release/v*
bash .agents/skills/sync-upstream/scripts/preview.sh fork-master origin/release/vX.Y.Z
```

脚本用 `git merge-tree` 在内存里试合并，不动工作区，输出四项：

1. fork 独有提交数 / 上游新增提交数；
2. 文本冲突文件和每个文件的冲突块数；
3. **隐性冲突**：fork 有没有在上游的数字编号空间（`src/lib/db/migrations/NNN_*.sql`）里新增迁移。git 不会报这类冲突，但编号相同会导致启动失败，或者某个迁移被静默跳过。这一项必须为空；
4. `.fork/seams.json` 里状态仍为 `claimed` 的 seam。

把这些结果报告给用户，确认后再继续。

## 3. 备份并 rebase

```bash
cd .claude/worktrees/fork-master
git status --short                        # 必须干净
git branch fork-master-backup-$(date +%Y%m%d) fork-master
git fetch origin
git rebase origin/release/vX.Y.Z
```

## 4. 解决冲突

注意：rebase 过程中，`--ours` / `HEAD` 指的是**上游那一侧**，`--theirs` 才是正在重放的 fork 提交。

**上游重构过的代码**（函数被拆到新模块、调用点挪了位置）：不要逐块拼接冲突。先对整个文件执行 `git checkout --ours -- <file>` 采用上游版本，再用 `git show <fork-commit> -- <file>` 看 fork 当初改了什么，把 fork 的意图重新加到上游的新位置。可以 `grep` 原来的锚点（比如 `persistAttemptLogs({`、`cacheSource: "upstream"`），找它们搬到了哪个子模块。

- ⚠️ 对整个文件用 `--ours` 时，fork 在这个文件里**能自动合并的那些改动也会一起丢掉**。必须把该 fork 提交对这个文件的**全部**改动逐条补回去，不能只补发生冲突的那几块。

**i18n JSON**（`src/i18n/messages/*.json`）：先采用上游版本，再按 JSON 路径补回 fork 新增的 key：

```bash
git checkout --ours -- src/i18n/messages/en.json src/i18n/messages/zh-CN.json src/i18n/messages/zh-TW.json
python3 .agents/skills/sync-upstream/scripts/i18n_reapply.py <fork-commit> \
  src/i18n/messages/en.json src/i18n/messages/zh-CN.json src/i18n/messages/zh-TW.json
```

**Seam**（规则见 AGENTS.md → "Fork seams"）：对每个 `claimed` 的 seam，读 `.fork/notes/<path>.md` 里的“重做”一节，判断上游现在是否已经提供了同样的行为。

- 如果上游已经提供：采用上游版本，从 `seams.json` 删掉这一条、删除对应的 note，把 `seamBudget` 减 1，单独提交一个 `chore(fork): retire <path> seam`。
- 如果上游没有提供：保留 fork 的改动，按 note 里的“重做”说明重新应用。
- 新的 fork 提交如果改了上游文件，必须同时补上登记和 note（格式参考现有的 `.fork/notes/*.md`）。
- `.gitignore` 也是 seam：fork 删掉了上游忽略 `.agents` 的两条规则。上游如果加回来，`.agents/skills/` 就会被重新忽略，要按它的 note 再删掉。
- 判断时要看具体代码和数据结构，不能只看关键词。例如上游把 `discriminator` 放进了 `SCHEMA_NODE_KEYS`（需要遍历的节点），并不等于它被加进了 `GEMINI_UNSUPPORTED_SCHEMA_KEYS`（需要删掉的字段）。

解决完冲突后执行 `git add <files>`，再用 `GIT_EDITOR=true git rebase --continue`。

## 5. fork 的数据库迁移

- fork 的迁移只能放在 `src/lib/db/migrations/fork/NNN_name.sql`。迁移执行器会把它记成 `fork-NNN`，排在上游所有数字编号的迁移之后执行（见 `src/lib/db/migrationRunner/forkMigrations.ts`）。**不要占用上游的数字编号。**
- 如果某个旧版 fork 曾经把迁移放进了数字编号（已部署的库里记录的是 `NNN_<fork名>`），要在 `forkMigrations.ts` 的 `FORK_LEGACY_SLOT_MIGRATIONS` 里登记 `NNN → fork-MMM`，并在 `tests/unit/db-migration-runner-fork-namespace.test.ts` 里补一个用例。**不要改上游的 `RENAMED_MIGRATION_COMPATIBILITY`**，上游有测试锁定了它的条目数和最后一条。
- 如果 fork 新增了列，`src/lib/db/schemaColumns.ts` 里对应的补列代码要保留，并把注释里引用的迁移名改成 `fork-NNN_…`。

## 6. 验证

按顺序执行：

```bash
# seam 登记与实际改动必须一致：每个改过的上游文件都已登记、登记和 note 一一对应、
# seamBudget 正确、没有已经和上游一致却还在登记的 seam
python3 .agents/skills/sync-upstream/scripts/check_seams.py
npm run typecheck:core
# 和本次改动相关的测试：迁移执行器测试 + fork 各提交自带的测试 + 引用了 fork 所改模块的测试
node --import tsx/esm --test --test-force-exit tests/unit/db-migration-runner*.test.ts \
  tests/unit/db-migrationrunner-constants-split.test.ts <fork 提交涉及的测试…>
# lint 要带上项目的豁免清单，否则会报出上游原有的违规
npx eslint --suppressions-location config/quality/eslint-suppressions.json \
  $(git diff --name-only origin/release/vX.Y.Z HEAD -- '*.ts' '*.tsx')
npx prettier --check $(git diff --name-only origin/release/vX.Y.Z HEAD -- '*.ts' '*.tsx' '*.json')
```

用真实的全部迁移初始化一次数据库（必须走 `core.ts`。直接调 `runMigrations` 会跳过补列步骤，从而报出不相干的错误）：

```bash
D=$(mktemp -d); DATA_DIR=$D DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm -e '
const {getDbInstance}=await import("./src/lib/db/core.ts");
const db=getDbInstance();
console.log(db.prepare("SELECT version,name FROM _omniroute_migrations ORDER BY rowid DESC LIMIT 3").all());
process.exit(0);'
```

最后一条记录应该是 fork 的最大 `fork-NNN`。

如果有测试失败，先判断是不是上游本来就红：看失败测试的依赖链有没有经过 `git diff --name-only origin/release/vX.Y.Z HEAD` 里的文件，再查 `gh issue list --repo diegosouzapw/OmniRoute --state open --search "Release branch not green in:title"`。如果和 fork 无关，在报告里注明“上游已有失败”，不要在 fork 里修。

如果某个测试依赖 mock 掉的 `fs`（比如 `db-migration-runner.test.ts`），fork 加载 `fork/` 子目录时必须经过 `readdirSync(MIGRATIONS_DIR)` 的列表，否则 mock 会漏掉这个子目录，测试会读到真实文件。

## 7. 整理提交历史

修正应该并回它所属的那个 fork 提交，不要额外堆一个“fix sync”提交：

```bash
git add <files>
git commit --fixup=<target-commit>
GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/release/vX.Y.Z
```

要单独修改中间某个提交时：用 `GIT_SEQUENCE_EDITOR="sed -i 's/^pick <sha>/edit <sha>/'" git rebase -i …`，改完后执行 `git commit --amend --no-edit`，再 `rebase --continue`。

整理完再跑一次第 2 步的预演脚本，确认上游新增提交数为 0、没有文本冲突、没有隐性冲突，seam 列表也符合预期。

## 8. 汇报

用中文汇报以下内容：

- 目标分支和提交范围（fork 提交数、上游新增提交数）；
- 每个冲突文件是怎么处理的（采用上游 / 重新应用 fork 改动 / 撤销 seam）；
- 迁移方面的变化；
- 验证命令和结果，其中上游原本就有的失败要单独列出；
- 备份分支名；
- 推送需要用户决定：推到哪个远端，是否用 `--force-with-lease`。

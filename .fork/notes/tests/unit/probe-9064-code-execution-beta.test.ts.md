# tests/unit/probe-9064-code-execution-beta.test.ts

kind: D · status: claimed · reason: Assert the API-key default carries no betas so code-execution arrives only via client negotiation instead of the old static set.

## 改动

把「`ANTHROPIC_BETA_API_KEY` 必须包含 code-execution beta」的静态断言反转为「必须为空字符串」，文件头注释同步改为描述新契约（beta 仅经 `FORWARDABLE_CLIENT_BETAS` 客户端协商进入）。客户端协商转发用例（#9064 merge 用例、#14200 skills 门用例）原样保留。

## 原因

API-key 路径改为默认零 beta 后，旧断言与实现冲突；该测试是静态默认集的永久守卫，需随契约更新。

## 重做

合并上游时保留反转后的断言。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/probe-9064-code-execution-beta.test.ts`。若上游自身改为默认零 beta，接受上游测试并移除本登记和说明。

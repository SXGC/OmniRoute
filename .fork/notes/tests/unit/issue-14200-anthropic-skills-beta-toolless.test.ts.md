# tests/unit/issue-14200-anthropic-skills-beta-toolless.test.ts

kind: D · status: claimed · reason: Assert the API-key path never emits code-execution/skills betas by default so the tool-less 400 guard matches the no-default-beta contract.

## 改动

四处断言更新：静态 `ANTHROPIC_BETA_API_KEY` 用例改为断言空字符串（原先要求 code-execution 保留）；`buildProviderHeaders("anthropic", ...)` 的 tool-less 与含 code_execution 两用例删除「code-execution beta 保留在 headers」断言，且含工具用例的 skills 断言反转为「不自动注入」（对象式与 JSON 序列化 body 两形态都断言）；`DefaultExecutor buildHeaders` 含 code_execution 用例的 skills 断言同样反转为「不自动注入」。即 anthropic 上有 code_execution 也不再自动发 skills——skills 只能经客户端协商进入。mergeClientAnthropicBeta 的客户端 skills body gate（无工具丢弃、有工具转发）原样保留；agentrouter、anthropic-compatible-cc 等其它 provider 的 skills body-gating 用例全部不动。

## 原因

API-key 路径默认零 beta 后，`maybeAppendSkillsBeta`/`syncSkillsBeta` 对 anthropic 的自动注入已禁用（见 anthropicHeaders.ts seam），旧断言与实现冲突。

## 重做

合并上游时保留更新后的断言（anthropic 含 code_execution 也不自动发 skills；客户端 skills body gate 仍在）。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/issue-14200-anthropic-skills-beta-toolless.test.ts`。若上游自身改为默认零 beta 且禁用 anthropic 自动 skills 注入，接受上游测试并移除本登记和说明。

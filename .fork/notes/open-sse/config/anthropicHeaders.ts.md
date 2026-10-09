# open-sse/config/anthropicHeaders.ts

kind: B · status: claimed · reason: Keep ANTHROPIC_BETA_API_KEY exported but empty and stop auto-injecting the skills beta for the direct anthropic provider, so its API-key path sends no default betas and everything arrives via client allowlist negotiation.

## 改动

`ANTHROPIC_BETA_API_KEY` 从「ANTHROPIC_BETA_BASE 去掉 oauth-2025-04-20 后 join」改为固定空字符串。导出保留（旧调用方仍可 import），`ANTHROPIC_BETA_FULL`、`ANTHROPIC_BETA_CLAUDE_OAUTH`、`FORWARDABLE_CLIENT_BETAS`、model/body 门（context-1m / skills）全部原样保留。

另（skills 自动注入禁用）：`maybeAppendSkillsBeta` 与 `syncSkillsBeta` 对 `provider === "anthropic"` 不再自动 append `skills-2025-10-02`——`maybeAppendSkillsBeta` 直接 return；`syncSkillsBeta` 在有 code_execution 工具时保留现有（客户端协商到达的）skills 而不追加，无工具时照常移除。`claude`（OAuth）、`anthropic-compatible-*`、CC wire image（agentrouter 等）与 `extraCondition` 分支行为不变。用户可见行为：直连 `anthropic`（API-key 认证）默认不发送任何 `anthropic-beta` 头，也不追加 `?beta=true` URL suffix；该路径上的 beta 一律来自客户端 `anthropic-beta` 请求头的允许名单转发（去重），`context-1m-2025-08-07` 额外按解析后的目标模型门控，`skills-2025-10-02` 按请求体是否含 `code_execution` 工具门控。`claude` OAuth provider 保持自己的静态 beta 集与 `?beta=true` suffix。

## 原因

anthropic API-key 路径此前默认携带一组静态 beta，客户端未协商时也会发送，导致上游按客户端未声明的特性解释请求体。新契约：默认零 beta，beta 一律经客户端 `anthropic-beta` 头按 `FORWARDABLE_CLIENT_BETAS` 允许名单协商进入。skills 自动注入违反该契约：`DefaultExecutor.buildHeaders` 的 `maybeAppendSkillsBeta` 与 base executor `execute` 的 `syncSkillsBeta` 都会在 code_execution 存在时替客户端注入 skills beta，OpenAI/openai-responses alternate 上同样泄漏；修复集中在两个共享 helper 内（不编辑 base.ts 调用点）。

## 重做

合并上游时保留空值定义。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/anthropic-api-key-beta-negotiation.test.ts tests/unit/probe-9064-code-execution-beta.test.ts tests/unit/issue-14200-anthropic-skills-beta-toolless.test.ts`。若上游自身改为默认零 beta 并保留客户端协商，接受上游实现并移除本登记和说明。

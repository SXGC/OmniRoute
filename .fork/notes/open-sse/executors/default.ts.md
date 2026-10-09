# open-sse/executors/default.ts

kind: D · status: claimed · reason: Forward the client's anthropic-workspace-id fill-gap style to upstreams whose effective protocol is Anthropic, and seed the client-beta allowlist merge for the direct anthropic provider so org-scoped API keys stop failing and client-negotiated betas survive without a static set.

## 改动

在 `DefaultExecutor.buildHeaders()` 中透传客户端的 `anthropic-workspace-id`：新增 fill-gap 辅助函数 `forwardClientAnthropicWorkspaceId`（仅在出站 headers 尚未设置时写入，连接级 `customHeaders` 优先），在 CC 提前返回分支与共享 `if (clientHeaders)` 块两处调用。门控基于连接的有效 Anthropic 协议（`usesClaudeCodeProtocol` 或 anthropic 形态 provider 且未切换 openai/openai-responses 备用格式），不会泄漏到非 Anthropic 协议。

另：`applyClientAnthropicBeta` 的 `seedWhenAbsent` 门从 `anthropic-compatible-` 前缀扩展为「先解析连接的有效 alternate format，排除 openai/openai-responses 后，`this.provider === "anthropic" ||` anthropic-compatible- 前缀匹配」。`anthropic` 注册项不再携带静态 `Anthropic-Beta`，没有该键时客户端协商的 beta 无处可写；seed 后由 `applyClientAnthropicBeta` 的空合并逻辑保证「无客户端 beta 或全部被拒」时不产生空头。alternate 门与 `forwardClientAnthropicWorkspaceId` 的门同形：若未来 registry 为 anthropic 声明 OpenAI 备用格式且连接选中它，seed 关闭，beta 不泄漏到 OpenAI 线（回归测试用可变 REGISTRY 注入模拟 alternate 验证）。

## 原因

Anthropic 对未绑定 workspace 的 org 级 API key 返回 400（"This API key is not scoped to a workspace"）。该头不在任何客户端头透传白名单内，上游原始行为会静默丢弃它。

API-key 路径改为默认零 beta 后，不 seed 的话客户端显式协商的允许名单 beta 会被静默丢弃，与「客户端协商为准」的新契约冲突。当前 `anthropic` 注册项无 `alternateFormats`，`resolveAlternate` 恒为 null；alternate 门是防未来回归的保护（registry 一旦声明 OpenAI 备用格式即生效），并非修当前漏洞。

## 重做

合并上游时保留该透传逻辑、门控与 seedWhenAbsent 扩展。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/anthropic-workspace-id-forward.test.ts tests/unit/anthropic-api-key-beta-negotiation.test.ts`。若上游已实现同等透传与 beta seed，接受上游实现并移除对应登记和本说明。

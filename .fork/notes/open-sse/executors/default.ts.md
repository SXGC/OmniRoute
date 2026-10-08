# open-sse/executors/default.ts

kind: D · status: claimed · reason: Forward the client's anthropic-workspace-id fill-gap style to upstreams whose effective protocol is Anthropic, so org-scoped API keys stop failing with 400.

## 改动

在 `DefaultExecutor.buildHeaders()` 中透传客户端的 `anthropic-workspace-id`：新增 fill-gap 辅助函数 `forwardClientAnthropicWorkspaceId`（仅在出站 headers 尚未设置时写入，连接级 `customHeaders` 优先），在 CC 提前返回分支与共享 `if (clientHeaders)` 块两处调用。门控基于连接的有效 Anthropic 协议（`usesClaudeCodeProtocol` 或 anthropic 形态 provider 且未切换 openai/openai-responses 备用格式），不会泄漏到非 Anthropic 协议。

## 原因

Anthropic 对未绑定 workspace 的 org 级 API key 返回 400（"This API key is not scoped to a workspace"）。该头不在任何客户端头透传白名单内，上游原始行为会静默丢弃它。

## 重做

合并上游时保留该透传逻辑及门控。运行 `DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/anthropic-workspace-id-forward.test.ts`（9 个用例）。若上游已实现同等透传，接受上游实现并移除对应登记和本说明。

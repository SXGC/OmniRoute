# tests/unit/claude-summarized-thinking-redact-beta.test.ts

kind: D · status: claimed · reason: Assert direct Anthropic API-key thinking requests forward only client-negotiated betas while retaining upstream Claude OAuth behavior.

## 改动

直连 `anthropic` API-key 的 adaptive 与 summarized thinking 请求均断言不默认注入 `REDACT`。保留其余 Claude API-key、OAuth、环境变量与显式 redact 协商测试。

## 原因

fork 的直连 Anthropic API-key 默认 beta 集为空。上游测试要求普通 adaptive 请求自动携带静态 redact beta，与此契约冲突。

## 重做

保留上游可读 thinking 与 OAuth 的断言，仅将直连 `anthropic` 请求改为断言不自动注入 redact beta。运行 `node --import tsx/esm --test --test-force-exit tests/unit/claude-summarized-thinking-redact-beta.test.ts tests/unit/anthropic-api-key-beta-negotiation.test.ts`。若上游采用同等零默认 beta 契约，采用上游测试并撤销登记及说明。

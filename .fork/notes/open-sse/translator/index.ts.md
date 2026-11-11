# open-sse/translator/index.ts

kind: D · status: claimed · reason: Replay the internal reasoning placeholder on assistant tool-call turns sent to native DeepSeek whose tool-call ids DeepSeek did not issue, so a combo fallback mid tool loop no longer 400s on missing reasoning_content.

## 改动

在 `replayOpenAIReasoningMessage()` 中计算 `needsPresencePlaceholder = requiresReasoningContentPresence(provider, model) || hasForeignToolCallsRequiringReasoning(provider, toolCalls)`，并用它替换原先两处 `requiresReasoningContentPresence(...)` 判断（`requiresExplicitReasoningReplay` 分支和通用分支），注释同步说明外部工具调用的情况；import 增加 `hasForeignToolCallsRequiringReasoning`。

## 原因

combo 在工具循环中途从其他 provider（如 OpenCode，未返回 reasoning）回落到原生 DeepSeek 时，回放的 assistant 工具调用轮次没有 reasoning_content，且工具调用 id 不是 DeepSeek 签发的；DeepSeek 返回 400 "The reasoning_content in the thinking mode must be passed back to the API"。上游只对 opencode/MiMo 等强制存在字段，原生 DeepSeek 一律保持缺省。

## 重做

保留两处判断使用 `needsPresencePlaceholder`。若上游重排该函数，把 `hasForeignToolCallsRequiringReasoning(provider, toolCalls)` 并入等价的"需要占位"判断。若上游已对外部工具调用补占位，采用上游并撤销本 seam 及相关 seam。

聚焦回归：

```bash
node --import tsx/esm --test --test-force-exit tests/unit/deepseek-foreign-toolcall-reasoning-presence.test.ts tests/unit/reasoning-cache.test.ts tests/unit/tool-request-sanitization.test.ts
```

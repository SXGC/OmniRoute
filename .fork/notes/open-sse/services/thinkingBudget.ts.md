# open-sse/services/thinkingBudget.ts

kind: B · status: claimed · reason: Always request Gemini 3.8 thought summaries for a non-zero thinking budget so streaming clients receive reasoning deltas instead of an idle stream during long thinking.

## 改动

`gemini38ThinkingConfig` 在 budget 大于 0 时固定返回 `{ thinkingLevel, includeThoughts: true }`，删除 `clientAskedForThoughts` 判断。budget 小于等于 0 时仍返回 `{ thinkingBudget: 0, includeThoughts: false }`，`reasoning_effort: "none"` 仍是关闭开关。该函数覆盖所有 `isGemini38Model` 匹配的模型（`gemini-3.8-*` 与 `gemini-4-*`），openai-to-gemini 与 claude-to-gemini 两条翻译路径都经过它。

## 原因

上游 #13463（10-08 由 `9b63ad3eb8` 重新合入）对 Gemini 3.8 改为客户端未带 `include_thoughts` 时不发 `includeThoughts`，理由是思考占用输出上限。结果是 3.8 流式请求在整段思考期间不返回任何增量，也没有心跳。DSH 知识库 Wiki 写作一步要思考 5K–12K token，流静默超过 300 秒，客户端判定空闲超时并重试，直至 30 分钟运行上限失败。2026-10-31 实测：不带 `include_thoughts` 时 low/high 档都无 `reasoning_content`；带上后约 8.7 秒开始回思考增量。思考 token 数两种情况相近（1.3K–2.1K），开启摘要不会明显多占输出上限。

## 重做

合并上游时保留 3.8 分支默认 `includeThoughts: true`。运行 `node --import tsx/esm --test tests/unit/gemini-38-thinking-level-output.test.ts`，确认默认、`reasoning_effort`、`thinking.budget_tokens` 与 Antigravity 封装各路径都带 `includeThoughts: true`，`reasoning_effort: "none"` 仍为 `includeThoughts: false`。若上游恢复默认发送或改用其他方式保持流活跃（如心跳），接受上游实现并移除本登记、测试登记和本说明。

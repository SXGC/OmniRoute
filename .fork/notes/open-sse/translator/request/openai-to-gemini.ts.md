# open-sse/translator/request/openai-to-gemini.ts

kind: B · status: claimed · reason: Apply the Antigravity identity strip to client system parts before they are relocated into the first user turn.

## 改动

1. 新增 import：`normalizeAntigravityClientSystemParts`，来自 fork 自有模块 `open-sse/services/antigravitySystemPromptNormalize.ts`。
2. `wrapInCloudCodeEnvelope` 里，`clientParts` 从 `envelope.request.systemInstruction?.parts?.slice() ?? []` 改为先经过 `normalizeAntigravityClientSystemParts(...)`。这一步做竞品身份句删除和 harness 标记改写，规则与 executor 处理 systemInstruction 时相同，并丢弃清洗后文本为空的 part。然后才把这些 part 搬到 `contents[0]` 开头（#9030）。

测试在 fork 自有文件 `tests/unit/antigravity-fork-client-system-identity-strip.test.ts`。

## 原因

#9030 之后，OpenAI/Claude 来源的客户端 `role: "system"` 内容被搬进第一条 user 消息，`systemInstruction` 只剩 `ANTIGRAVITY_DEFAULT_SYSTEM`。executor 的身份句清洗只处理 `systemInstruction`，所以客户端 system 里的 "You are Claude Code…"、Codex、DeepSeek Harness 横幅会原样发给 Antigravity 上游。到了 executor 阶段，已经无法区分 `contents[0]` 里哪些 part 来自 system、哪些来自用户输入，所以只能在翻译器搬运之前清洗。用户消息本身不做处理。

## 重做

合并上游时：

- 如果上游改写了 `wrapInCloudCodeEnvelope` 的搬运逻辑，保证搬运之前的客户端 system parts 都经过 `normalizeAntigravityClientSystemParts`。
- 如果上游不再搬运（client system 留在 `systemInstruction`），executor 的清洗已经覆盖它，就删掉这条 seam、这份笔记和对应测试。
- 合并后运行 `tests/unit/antigravity-fork-client-system-identity-strip.test.ts` 和 `tests/unit/repro-9030-antigravity-system-429s.test.ts`。

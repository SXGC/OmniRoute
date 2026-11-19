# open-sse/translator/request/openai-to-gemini.ts

kind: B · status: claimed · reason: Apply the Antigravity identity strip to client system parts before they are relocated into the first user turn, and let OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM replace the default systemInstruction text.

## 改动

1. 去掉上游对 `ANTIGRAVITY_DEFAULT_SYSTEM` 的 import，改为从 fork 自有模块 `open-sse/services/antigravitySystemPromptNormalize.ts` import `getAntigravityDefaultSystem` 和 `normalizeAntigravityClientSystemParts`。
2. `wrapInCloudCodeEnvelope` 里，`defaultPart` 从 `{ text: ANTIGRAVITY_DEFAULT_SYSTEM }` 改为 `{ text: getAntigravityDefaultSystem() }`。
3. 同一函数里，`clientParts` 从 `envelope.request.systemInstruction?.parts?.slice() ?? []` 改为先经过 `normalizeAntigravityClientSystemParts(...)`。这一步做竞品身份句删除和 harness 标记改写，规则与 executor 处理 systemInstruction 时相同，并丢弃清洗后文本为空的 part。然后才把这些 part 搬到 `contents[0]` 开头（#9030）。

测试在 fork 自有文件 `tests/unit/antigravity-fork-client-system-identity-strip.test.ts` 和 `tests/unit/antigravity-fork-default-system-env.test.ts`。

## 环境变量 `OMNIROUTE_ANTIGRAVITY_DEFAULT_SYSTEM`

- 设置为非空白文本时，OpenAI/Claude/Responses 来源、经过翻译的 Antigravity 请求的 `systemInstruction` 用这段文本替换内置的 `ANTIGRAVITY_DEFAULT_SYSTEM`。原样使用，不做 trim。
- 未设置或只有空白时，使用内置默认值。
- 每次请求都会重新读取，不在 import 时缓存。
- 客户端直接发 Gemini/Antigravity 原生格式时不经过这里，不受影响。
- 文本仍会经过 executor 的 systemInstruction 清洗，写进去的竞品身份句（如 "You are Claude Code"）会被删掉。文本要保持短小：#9030 正是 `systemInstruction` 过大触发 429。
- 上游是否校验默认身份文本没有核实过，换文本前应在真实账号上实测。
- 门禁 `check:env-doc-sync` 的豁免见 `.fork/notes/scripts/check/check-env-doc-sync.mjs.md`。

## 原因

#9030 之后，OpenAI/Claude 来源的客户端 `role: "system"` 内容被搬进第一条 user 消息，`systemInstruction` 只剩默认文本。executor 的身份句清洗只处理 `systemInstruction`，所以客户端 system 里的 "You are Claude Code…"、Codex、DeepSeek Harness 横幅会原样发给 Antigravity 上游。到了 executor 阶段，已经无法区分 `contents[0]` 里哪些 part 来自 system、哪些来自用户输入，所以只能在翻译器搬运之前清洗。用户消息本身不做处理。

默认文本写死在上游常量里，部署时无法替换；环境变量让运营方不改代码就能换掉它。

## 重做

合并上游时：

- 如果上游改写了 `wrapInCloudCodeEnvelope` 的搬运逻辑，保证搬运之前的客户端 system parts 都经过 `normalizeAntigravityClientSystemParts`，并且 `systemInstruction` 的默认文本仍来自 `getAntigravityDefaultSystem()`。
- 如果上游不再搬运（client system 留在 `systemInstruction`），executor 的清洗已经覆盖它，就删掉第 3 项改动和对应测试；环境变量那部分照旧保留。
- 合并后运行 `tests/unit/antigravity-fork-client-system-identity-strip.test.ts`、`tests/unit/antigravity-fork-default-system-env.test.ts` 和 `tests/unit/repro-9030-antigravity-system-429s.test.ts`。

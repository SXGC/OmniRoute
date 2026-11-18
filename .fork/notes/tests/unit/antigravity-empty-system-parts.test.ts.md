# tests/unit/antigravity-empty-system-parts.test.ts

kind: B · status: claimed · reason: Assert the fork behavior that Gemini 4 and other non-Claude Antigravity chat models also get the systemInstruction identity rewrite.

## 改动

上游用例 "models outside the Claude and trailing-turn families keep their system text untouched" 改名为 "... drop empty parts and identity text"，对 `gemini-4-argon-high` 和 `gpt-oss-120b-medium` 的期望从 `[{ text: identity }]` 改为 `[{ text: "" }]`：空 part 被删掉，身份句也被删掉。

## 原因

fork 让这些模型也走身份句清理（见 `open-sse/executors/antigravity.ts` 的 note），上游这条用例断言的正好是相反的行为。

## 重做

合并上游时保留新的期望。如果上游也开始对这些模型做身份句清理，接受上游用例，删除本登记和本说明。

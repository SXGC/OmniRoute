# open-sse/executors/antigravity.ts

kind: B · status: claimed · reason: Strip Codex CLI and DeepSeek Harness identity banners and apply the systemInstruction identity rewrite to Gemini 4 and other non-Claude Antigravity chat models.

## 改动

1. `COMPETITIVE_AGENT_PROMPT_PATTERNS` 末尾新增两条规则，只删除身份句本身，同一行后面的内容保留：
   - Codex CLI 横幅：`You are Codex, ... based on GPT-5[.x][-suffix].`，覆盖 0.169 的 `a coding agent` 写法和旧的 `an agent` 写法。
   - DeepSeek Harness 横幅：`You are an AI agent powered by DeepSeek Harness.`
2. `transformRequest` 里 `transformedRequest` 三元表达式的最后一个分支，从上游的 `dropEmptyAntigravitySystemParts(rawTransformedRequest)` 改为 `normalizeAntigravityGeminiSystemInstruction(dropEmptyAntigravitySystemParts(rawTransformedRequest))`。这样 `gemini-4-*`、`gpt-oss-*` 等既不是 Claude、也不匹配 `isGeminiTrailingModelTurnRejectingModel` 的模型，也会做身份句清理。末尾 assistant turn 依旧不剥离。

测试在 fork 自有文件 `tests/unit/antigravity-fork-identity-strip.test.ts`。

## 原因

Antigravity 上游遇到 systemInstruction 里的竞品身份句时，会返回一个假的 `429 RESOURCE_EXHAUSTED`。零宽字符混淆（U+200B、U+034F）已经被上游识别（CLIProxyAPI #7433、#7545），只能删掉整句。上游的规则只覆盖 Claude 系身份句，而且 gemini-4 分支完全不做清理（上游 v3.8.55 的注释写明 "no identity rewrite"）。

## 重做

合并上游时：

- 如果上游在这个列表里加了 Codex 或 DSH 规则，就改用上游的规则，删掉 fork 的两行。
- 上游如果再改最后一个分支，要保证空 part 清理（#19503 的 `dropEmptyAntigravitySystemParts`）和身份句清理都执行。
- 合并后运行 `tests/unit/antigravity-fork-identity-strip.test.ts`。

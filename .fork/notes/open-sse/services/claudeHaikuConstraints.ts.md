# open-sse/services/claudeHaikuConstraints.ts

kind: D · status: claimed · reason: Preserve adaptive thinking for Haiku 5+ aliases not yet covered by upstream model specs.

## 改动

保留上游 isAdaptiveThinkingOnly 规格判断，并在旧 Haiku 降级前按家族后的主版本号排除 Haiku 5+。

## 原因

上游已保护规格表中的 claude-haiku-5-5，但尚未覆盖 haiku-5.5、haiku-5-5 等别名和未来主版本；这些模型不应被改写为 enabled。

## 重做

先保留上游规格判断，再保留 MODERN_HAIKU_PATTERN 和主版本号 >= 5 的兜底。运行 claude-haiku-no-adaptive-thinking.test.ts。若上游已覆盖同等别名和未来版本行为，采用上游并删除此登记与说明。

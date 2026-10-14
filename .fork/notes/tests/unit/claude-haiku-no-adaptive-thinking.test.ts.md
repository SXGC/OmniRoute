# tests/unit/claude-haiku-no-adaptive-thinking.test.ts

kind: D · status: claimed · reason: Guard Haiku 5+ adaptive-thinking pass-through for uncatalogued aliases while preserving legacy downgrades.

## 改动

保留 Haiku 5+ 别名和未来主版本的 adaptive thinking 与 effort 原样透传用例。

## 原因

上游测试只保护模型规格表中的 Haiku 5.5；fork 还需保护未登记的 Haiku 5+ 别名。

## 重做

与 claudeHaikuConstraints.ts 的版本兜底一起保留新增用例，确认旧 3.x/4.x Haiku 仍按上游规则降级。上游提供同等覆盖后，删除对应 fork 用例并撤销登记与说明。

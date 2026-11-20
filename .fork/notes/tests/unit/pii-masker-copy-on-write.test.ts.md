# tests/unit/pii-masker-copy-on-write.test.ts

kind: D · status: claimed · reason: Assert PIIMaskerGuardrail returns null meta without scanning when PII_REDACTION_ENABLED is off.

## 改动

将 `PII_REDACTION_ENABLED` 关闭用例的断言从 `result.meta.detections >= 1` 调整为 `assert.equal(result.meta, null)`，以匹配 fork 在 flag 关闭时跳过全量 PII 正则扫描的快速路径。

## 原因

配合 `src/lib/guardrails/piiMasker.ts` 的关闭态 fast-return。

## 重做

合并上游时若 `src/lib/guardrails/piiMasker.ts` 的 seam 被撤销，同步恢复本测试断言并移除本 seam。

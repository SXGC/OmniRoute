# tests/unit/characterization-guardrails.test.ts

kind: D · status: claimed · reason: Assert PIIMaskerGuardrail returns null meta without scanning when PII_REDACTION_ENABLED is off.

## 改动

将 `pii-masker with the PII flags OFF never mutates the request payload` 用例中的 `result.meta.detections > 0` 断言调整为 `assert.equal(result.meta, null)`，匹配 fork 关闭态 fast-return。

## 原因

配合 `src/lib/guardrails/piiMasker.ts` 的关闭态 fast-return。

## 重做

合并上游时若 `src/lib/guardrails/piiMasker.ts` 的 seam 被撤销，同步恢复本测试断言并移除本 seam。

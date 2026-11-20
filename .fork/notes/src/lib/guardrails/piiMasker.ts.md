# src/lib/guardrails/piiMasker.ts

kind: D · status: claimed · reason: Short-circuit PIIMaskerGuardrail.preCall when PII_REDACTION_ENABLED is off and postCall when PII_RESPONSE_SANITIZATION is off instead of scanning full request/response trees with international PII regexes on every call.

## 改动

1. `cloneAndMaskRequestPayload` 中在 `const redact = isRequestPiiMaskingEnabled()` 为 `false` 时立即返回 `{ detections: [], modified: false, payload }`，不再拷贝 `messages`/`input` 并对每个文本叶子跑全套国际 PII 正则。
2. `PIIMaskerGuardrail.postCall` 中在 `isPiiSanitizationEnabled()` 为 `false` 时立即返回 `{ block: false }`，避免对每个非流式响应做 3 次 `JSON.stringify`。

## 原因

线上默认 `PII_REDACTION_ENABLED=false`、`PII_RESPONSE_SANITIZATION=false`，但原先 `preCall` 仍会在每次大上下文请求进门时遍历全部消息并执行数十条国际 PII 正则（Codice Fiscale / 瑞典社保号 / IBAN / VAT 等），实测单次阻塞主线程 100–162 ms 且结果不被消费。

## 重做

合并上游时，若上游已在 `PII_REDACTION_ENABLED=false` 时跳过扫描，采用上游并移除本 seam 与两个测试 seam；否则保留 fast-return 并运行 `tests/unit/perf-stream-usage-and-pii-fastpath.test.ts` 与 guardrail 相关测试。

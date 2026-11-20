# open-sse/utils/stream.ts

kind: D · status: claimed · reason: Evaluate getAccountingUsage() lazily inside sanitizePassthroughUsage only on Claude message_delta events instead of re-estimating request body tokens on every passthrough SSE delta chunk.

## 改动

`sanitizePassthroughUsage` 中原本无条件写成 `repairClaudeFinalWireUsage(payload, getAccountingUsage()) || changed`。改为仅当 `(payload as { type?: unknown } | null)?.type === "message_delta"` 时才求值 `getAccountingUsage()` 并调用 `repairClaudeFinalWireUsage`。

测试在 fork 自有文件 `tests/unit/passthrough-stream-no-per-chunk-usage-estimate.test.ts`。

## 原因

`repairClaudeFinalWireUsage` 只在 `event?.type === "message_delta"` 时起作用，但 `getAccountingUsage()` 作为函数实参会在每个 passthrough SSE `data:` 分片上提前求值。对于 `/v1/responses` → `codex` 等流式透传，上游只在末尾 `response.completed` 才下发 usage；流式输出期间每次 `response.output_text.delta` 都会走 `resolveStreamAccountingUsage` → `finalizeStreamingUsage` → `estimateInputTokens(body)`，对 1MB+ 请求体反复执行 `JSON.stringify` 和正则切分，导致 1,000+ 输出分片同步卡死主线程 100–160 秒并触发上游 `ERR_HTTP2_STREAM_ERROR`。

## 重做

合并上游时：

- 若上游已在 `sanitizePassthroughUsage` 或 `repairClaudeFinalWireUsage`（例如改为惰性回调）中避免非 `message_delta` 分片调用 `getAccountingUsage()`，接受上游并撤销本 seam。
- 否则保留该短路判断。

聚焦回归：

```bash
DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/passthrough-stream-no-per-chunk-usage-estimate.test.ts tests/unit/native-claude-accounting.test.ts
```

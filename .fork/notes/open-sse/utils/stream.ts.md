# open-sse/utils/stream.ts

kind: D · status: claimed · reason: Only invoke nativeClaudeUsage.getUsage() in getAccountingUsage() when native Claude stream events were observed, avoiding wasted request-body token estimation on non-Claude streams.

## 改动

`getAccountingUsage` 中原本无条件写成 `nativeUsage: nativeClaudeUsage.getUsage(observedContentLength())`。改为先读取 `native = nativeContent.hasObserved()`，仅当 `native === true` 时才调用 `nativeClaudeUsage.getUsage(contentLength)`，否则传 `null`。

（此前针对 `sanitizePassthroughUsage` 在非 `message_delta` 事件上提前求值 `getAccountingUsage()` 的改动已由上游 `#20086/#20480` 的 `open-sse/utils/streamUsageGuard.ts` 原生覆盖。）

测试在 fork 自有文件 `tests/unit/passthrough-stream-no-per-chunk-usage-estimate.test.ts` 和 `tests/unit/perf-stream-usage-and-pii-fastpath.test.ts`。

## 原因

`resolveStreamAccountingUsage` 仅在 `input.native === true`（原生 Claude 流）时读取 `input.nativeUsage`，但 `getAccountingUsage` 此前在所有非 Claude 流（Codex / DeepSeek / Gemini）结束 `flush()` 时仍无条件调用 `nativeClaudeUsage.getUsage()` → `finalizeStreamingUsage(null, body, contentLength)` → `estimateInputTokens(body)`，线上 CPU profile 实测单次阻塞主线程 428 ms 后被直接丢弃。

## 重做

合并上游时：

- 若上游已在 `getAccountingUsage` 中避免非 Claude 流调用 `nativeClaudeUsage.getUsage()`，接受上游并撤销本 seam。
- 否则保留 `native ? nativeClaudeUsage.getUsage(contentLength) : null` 短路判断。

聚焦回归：

```bash
DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/passthrough-stream-no-per-chunk-usage-estimate.test.ts tests/unit/perf-stream-usage-and-pii-fastpath.test.ts tests/unit/native-claude-accounting.test.ts
```

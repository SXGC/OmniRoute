# src/lib/usage/callLogs.ts

kind: B · status: claimed · reason: Persist and return the upstream-declared response model on call logs, and offload pure payload protection (when PII sanitization is disabled) to callLogArtifactWorker.

## 改动

1. `CallLogSummaryRow` 加上 `upstream_response_model`；`mapSummaryRow` 输出 `upstreamResponseModel`；`buildCallLogRow` 把 trim 后的 `entry.upstreamResponseModel` 写进 `upstreamResponseModel`；`insertCallLogRow` 的 INSERT 列和参数里，在 `requested_model` 后面加上 `upstream_response_model` / `@upstreamResponseModel`。
2. `buildCallLogRow` 与 `publishCallLogDetail`：当 `isPiiSanitizationEnabled()` 为 `false`（默认）时，除 `requestType === "search"` 的 `requestBody`（同步生成 `request_summary`）与带 `responseId` 时的 `pipelinePayloads`（同步写入 `seedPendingContinuationState`）外，不再在主线程同步递归执行 `protectRequestBodyForLog` / `protectPayloadForLog` / `protectErrorPayloadForLog` / `protectPipelinePayloads`，改用 `hasProtectablePayload` / `hasProtectablePipelinePayloads` 判定存在性，并把 `detailArtifactProtection` 交给 `writeCallArtifactAsync` 在 `callLogArtifactWorker` 线程中执行。

## 原因

1. 上游只记录路由后的模型。当 Responses 上游在 payload 里自报的模型和路由模型不一致时（例如被静默降级或替换），请求日志里看不出来。这个字段只用于日志，不影响计费。
2. 大上下文请求结束时，`buildCallLogRow` 在主线程同步对 `requestBody` / `responseBody` / `pipelinePayloads` 执行 3–4 轮全树深拷贝与正则脱敏，阻塞事件循环并造成 CPU 毛刺；将纯脱敏下沉到已有 `callLogArtifactWorker` 线程即可把这部分计算移出主线程，同时保留 PII 开关开启、search 摘要与 Responses continuation 桥接的既有语义。

## 重做

合并上游时：
1. 先看 `persistAttemptLogs` 成功路径和 `call_logs` 写入/查询有没有被上游挪动，按第 1 条重新加上 `upstreamResponseModel`；若上游已原生支持，则移除该部分。
2. 检查 `buildCallLogRow` / `publishCallLogDetail` 中对 `protectedRequestBody` / `protectedResponseBody` / `protectedPipelinePayloads` 的主线程依赖有没有新增字段，按第 2 条接入 `callLogPayloadProtectionCore.ts` 与 `detailArtifactProtection`；若上游已把日志脱敏迁进 worker，则采用上游实现并移除相关 seam。
3. 运行 `node --import tsx/esm --test tests/unit/upstream-response-model.test.ts tests/unit/call-log-upstream-response-model.test.ts tests/unit/call-log-worker-offload-protection.test.ts`。

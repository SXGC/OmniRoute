# open-sse/handlers/chatCore/attemptLogging.ts

kind: B · status: claimed · reason: Carry the upstream-declared response model from chat attempts into call logs and log meta.

## 改动

`PersistAttemptLogsArgs` 加上 `upstreamResponseModel?: string | null`，并在解构里取出来；saveCallLog 入参在 `requestedModel` 后面加上 `upstreamResponseModel`；`attachLogMeta` 里加上 `upstreamResponseModel`。

## 原因

上游只记录路由后的模型。当 Responses 上游在 payload 里自报的模型和路由模型不一致时（例如被静默降级或替换），请求日志里看不出来。这个字段只用于日志，不影响计费。

## 重做

合并上游时，先看 `persistAttemptLogs` 成功路径和 call_logs 写入/查询有没有被上游挪动，再按“改动”一节在新位置重新加上 `upstreamResponseModel`。运行 `node --import tsx/esm --test tests/unit/upstream-response-model.test.ts tests/unit/call-log-upstream-response-model.test.ts`。如果上游自己开始记录 Responses 上游自报的模型，就采用上游实现，移除本功能相关的全部 seam 和说明。

# src/shared/components/RequestLoggerV2.tsx

kind: B · status: claimed · reason: Show an Upstream Model column in the request log table.

## 改动

列定义里加上 `upstreamModel`；表头和单元格在 `visibleColumns.upstreamModel` 为真时显示。有值时用红色字体显示上游自报的模型，悬停提示 `upstreamModelTitle`；没有值时显示 —。

## 原因

上游只记录路由后的模型。当 Responses 上游在 payload 里自报的模型和路由模型不一致时（例如被静默降级或替换），请求日志里看不出来。这个字段只用于日志，不影响计费。

## 重做

合并上游时，先看 `persistAttemptLogs` 成功路径和 call_logs 写入/查询有没有被上游挪动，再按“改动”一节在新位置重新加上 `upstreamResponseModel`。运行 `node --import tsx/esm --test tests/unit/upstream-response-model.test.ts tests/unit/call-log-upstream-response-model.test.ts`。如果上游自己开始记录 Responses 上游自报的模型，就采用上游实现，移除本功能相关的全部 seam 和说明。

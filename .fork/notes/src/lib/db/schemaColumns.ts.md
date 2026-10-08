# src/lib/db/schemaColumns.ts

kind: B · status: claimed · reason: Back-fill call_logs.upstream_response_model for databases that skipped the fork migration.

## 改动

在 `ensureCallLogsColumns` 里，`resilience_actions` 的补列代码之后加上 `upstream_response_model TEXT DEFAULT NULL` 的补列。注释引用 `fork-001_call_logs_upstream_response_model`。

## 原因

日志列表的 SELECT 会读取这一列。没跑过 fork 迁移的库如果缺这一列，会报 no such column。上游只记录路由后的模型。当 Responses 上游在 payload 里自报的模型和路由模型不一致时（例如被静默降级或替换），请求日志里看不出来。这个字段只用于日志，不影响计费。

## 重做

合并上游时，先看 `persistAttemptLogs` 成功路径和 call_logs 写入/查询有没有被上游挪动，再按“改动”一节在新位置重新加上 `upstreamResponseModel`。运行 `node --import tsx/esm --test tests/unit/upstream-response-model.test.ts tests/unit/call-log-upstream-response-model.test.ts`。如果上游自己开始记录 Responses 上游自报的模型，就采用上游实现，移除本功能相关的全部 seam 和说明。

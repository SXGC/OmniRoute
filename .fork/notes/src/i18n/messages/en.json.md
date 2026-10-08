# src/i18n/messages/en.json

kind: B · status: claimed · reason: Add request-logger strings for the upstream-declared model.

## 改动

在 `requestLogger` 下新增 `upstreamModelTitle`、`columns.upstreamModel`、`detail.upstreamActual`、`detail.upstreamModelTitle` 四个 key。

## 原因

上游只记录路由后的模型。当 Responses 上游在 payload 里自报的模型和路由模型不一致时（例如被静默降级或替换），请求日志里看不出来。这个字段只用于日志，不影响计费。

## 重做

合并时如果有冲突，先采用上游版本，再执行 `python3 .agents/skills/sync-upstream/scripts/i18n_reapply.py <feat(logs) 提交> src/i18n/messages/en.json src/i18n/messages/zh-CN.json src/i18n/messages/zh-TW.json`，按 JSON 路径补回这四个 key。合并上游时，先看 `persistAttemptLogs` 成功路径和 call_logs 写入/查询有没有被上游挪动，再按“改动”一节在新位置重新加上 `upstreamResponseModel`。运行 `node --import tsx/esm --test tests/unit/upstream-response-model.test.ts tests/unit/call-log-upstream-response-model.test.ts`。如果上游自己开始记录 Responses 上游自报的模型，就采用上游实现，移除本功能相关的全部 seam 和说明。

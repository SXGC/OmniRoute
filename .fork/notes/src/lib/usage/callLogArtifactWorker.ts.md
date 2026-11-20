# src/lib/usage/callLogArtifactWorker.ts

kind: B · status: claimed · reason: Run optional pure single-pass call-log payload protection inside the worker thread before writing the artifact, mirroring PROVIDER_SAFETY_STOPS_TERMINAL.

## 改动

1. `WriteRequest` 增加可选字段 `protection?: CallLogArtifactProtection`，`environment` 增加 `providerSafetyStopsTerminal?: string` 并在 `applyWriteEnvironment` 中映射到 `process.env.PROVIDER_SAFETY_STOPS_TERMINAL`。
2. 在调用 `writeCallArtifact` 前，若存在 `request.protection`，调用 fork-owned 的 `protectArtifactForWorker(request.artifact, request.protection)` 完成单次遍历脱敏；未传 `protection` 时保持原样向后兼容。

## 原因

配合 `src/lib/usage/callLogs.ts` 把大 payload 的日志脱敏、inline image 替换、encrypted_content 省略与错误子树裁剪从主事件循环下沉到已有的 `callLogArtifactWorker` 线程，同时保持 worker bundle 无 SQLite/DB 依赖。

## 重做

合并上游时，确认 `WriteRequest` 与 `applyWriteEnvironment` 是否有新增字段，重新接入 `protectArtifactForWorker` 与 `PROVIDER_SAFETY_STOPS_TERMINAL` 同步。运行 `tests/unit/call-log-artifact-worker.test.ts` 与 `tests/unit/call-log-worker-offload-protection.test.ts`。如果上游原生把 payload 脱敏放进该 worker，采用上游实现并移除本 seam。

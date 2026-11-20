# src/lib/usage/callLogArtifactWriter.ts

kind: B · status: claimed · reason: Pass optional payload protection flags and PROVIDER_SAFETY_STOPS_TERMINAL snapshot to callLogArtifactWorker, and isolate DataCloneError per item with a JSON-safe fallback.

## 改动

1. `writeCallArtifactAsync(artifact, protection?)` 增加可选 `protection?: CallLogArtifactProtection` 参数，并在 `environment` 快照中传递 `providerSafetyStopsTerminal: isProviderSafetyStopsEnabled() ? "true" : undefined`。
2. `pump()` 中若 `postMessage` 抛出 `DataCloneError`（例如原始 payload 含不可克隆函数/对象），先尝试保护后 JSON 序列化回退再投递；仍不可克隆时仅丢弃当前单条并继续 `pump()` 队列，不触发整队 `failOpen`。

## 原因

将未预脱敏的原始 payload 直接通过 `postMessage` 交给 `callLogArtifactWorker` 处理，避免主线程多轮递归遍历，同时防止偶发不可克隆字段导致整个日志写入队列被清空。

## 重做

合并上游时，检查 `QueueItem`、`pump()`、`writeCallArtifactAsync` 签名与 worker 错误处理逻辑，重新接入可选 `protection` 参数、`providerSafetyStopsTerminal` 透传和 `DataCloneError` 隔离。注意保持 `Reflect.construct(Worker, ...)` 不变以通过打包策略测试。运行 `tests/unit/call-log-artifact-worker.test.ts` 与 `tests/unit/call-log-worker-offload-protection.test.ts`。

# src/lib/usage/callLogArtifactWriter.ts

kind: B · status: claimed · reason: Pass optional payload protection flags and PROVIDER_SAFETY_STOPS_TERMINAL snapshot to callLogArtifactWorker, isolate DataCloneError per item with a JSON-safe fallback, and keep the unref'd worker warm across idle periods.

## 改动

1. `writeCallArtifactAsync(artifact, protection?)` 增加可选 `protection?: CallLogArtifactProtection` 参数，并在 `environment` 快照中传递 `providerSafetyStopsTerminal: isProviderSafetyStopsEnabled() ? "true" : undefined`。
2. `pump()` 中若 `postMessage` 抛出 `DataCloneError`（例如原始 payload 含不可克隆函数/对象），先尝试保护后 JSON 序列化回退再投递；仍不可克隆时仅丢弃当前单条并继续 `pump()` 队列，不触发整队 `failOpen`。
3. 移除 30 秒空闲自动 `terminateWorker` 定时器（`IDLE_TIMEOUT_MS` / `idleTimer`），改为 `parkIdleWorker()` 仅调用 `worker.unref()` 让 worker 常驻预热、同时不阻塞进程退出。

## 原因

1. 将未预脱敏的原始 payload 直接通过 `postMessage` 交给 `callLogArtifactWorker` 处理，避免主线程多轮递归遍历，同时防止偶发不可克隆字段导致整个日志写入队列被清空。
2. 长驻服务空转超过 30 秒后反复销毁并冷启动 V8 worker isolate 会制造瞬时 ~80% CPU 毛刺；保留 `worker.unref()` 即可在不影响 CLI/测试退出的前提下消除反复冷启动抖动。

## 重做

合并上游时，检查 `QueueItem`、`pump()`、`writeCallArtifactAsync` 签名与空闲回收逻辑，重新接入可选 `protection` 参数、`providerSafetyStopsTerminal` 透传、`DataCloneError` 隔离以及去定时器的 `parkIdleWorker()`。注意保持 `Reflect.construct(Worker, ...)` 不变以通过打包策略测试。运行 `tests/unit/call-log-artifact-worker.test.ts` 与 `tests/unit/call-log-worker-offload-protection.test.ts`。

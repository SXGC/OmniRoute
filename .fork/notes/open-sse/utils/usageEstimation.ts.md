# open-sse/utils/usageEstimation.ts

kind: D · status: claimed · reason: Replace regex match/replace/split/filter allocations in estimateTokenCount with a zero-allocation single-pass character loop to eliminate multi-hundred-ms stalls and GC pressure on large prompts.

## 改动

将 `estimateTokenCount` 中原本的 `text.match(...)` + `text.replace(...)` + `.split(/(\s+|[^\w\s]|(?<=[a-z])(?=[A-Z]))/).filter(...)` 改为单趟零堆分配的 `charCodeAt` 循环（保留 CJK 字符、代理对 U+20000..U+2FA1F、空白、标点与 camelCase 切分的等价计数规则）。

## 原因

大上下文（150k+ tokens）触发 token 估算时，原先 `.split(...).filter(...)` 会一次性分配数十万个临时子串，线上 CPU profile 实测单次耗时 343 ms 并触发长时间 V8 GC 停顿。

## 重做

合并上游时，若上游已用零分配扫描或更高效实现替换 `estimateTokenCount`，采用上游并移除本 seam；否则保留单趟循环并运行 `tests/unit/perf-stream-usage-and-pii-fastpath.test.ts`。

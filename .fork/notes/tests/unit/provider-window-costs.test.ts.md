# tests/unit/provider-window-costs.test.ts

kind: D · status: claimed · reason: Pin the duration-inferred Codex weekly window behavior with regression tests.

## 改动

在文件末尾追加 4 个用例：7 天 session 窗口、5 小时 session 窗口回退到滚动 7 天、具名 weekly 优先、缺少 `windowSeconds` 时按 `displayName` 判断。

## 原因

这 4 个用例锁定 `providerWindowCosts.ts` 那个 seam 的行为，防止合并上游时被悄悄冲掉。

## 重做

合并上游时，保留这 4 个追加的用例。如果上游重构了测试里的 helper，就按新 helper 改写，用例的断言不变。和 `providerWindowCosts.ts` 的 seam 一起撤销。

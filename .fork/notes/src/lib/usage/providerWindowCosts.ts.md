# src/lib/usage/providerWindowCosts.ts

kind: D · status: claimed · reason: Treat a Codex session quota whose real window is 7 days as the weekly USD-cost window.

## 改动

新增 `isDurationWeeklyQuota`：先用 `windowSeconds` 经 `inferWindowFamilyLabel` 判断，没有时再看 `displayName === "Weekly"`。`scoreWeeklyQuota(name, quota)` 在名字里不含 weekly/7d 时，对这种窗口返回 `DURATION_INFERRED_WEEKLY_SCORE`（-1000），所以只有在没有具名 weekly 窗口时它才会被选中。`quotaName` 优先使用 `displayName`。

## 原因

Codex Pro 唯一的 7 天窗口存放在 `session` 这个 key 下。上游只按名字匹配 weekly/7d，导致 USD 成本弹窗里的已用百分比和“100% 估算”一直显示 n/a。

## 重做

合并上游时，保留“按时长推断 weekly、但分数低于所有具名 weekly”的规则。运行 `node --import tsx/esm --test tests/unit/provider-window-costs.test.ts`，fork 新增的 4 个用例都要通过。如果上游已经按窗口时长识别 weekly，就采用上游实现，移除本 seam 和对应的测试 seam。

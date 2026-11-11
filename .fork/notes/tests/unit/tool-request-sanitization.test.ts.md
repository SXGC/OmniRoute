# tests/unit/tool-request-sanitization.test.ts

kind: D · status: claimed · reason: Use a DeepSeek-issued call_00_ tool-call id in the fixture asserting reasoning_content stays absent, since foreign ids now get the presence placeholder.

## 改动

"translateRequest omits reasoning_content for DeepSeek assistant tool calls" 用例的 id 由 `call_1` 改为 `call_00_sum1`（tool_call_id 同步），断言不变。

## 原因

同上：旧 id 在 fork 逻辑下被视为外部调用，会补占位，与该用例要验证的 DeepSeek 签发路径不符。

## 重做

保留 `call_00_` 前缀的 id。若撤销 translator/index.ts 的 seam，本条一并撤销。

聚焦回归：

```bash
node --import tsx/esm --test --test-force-exit tests/unit/deepseek-foreign-toolcall-reasoning-presence.test.ts tests/unit/reasoning-cache.test.ts tests/unit/tool-request-sanitization.test.ts
```

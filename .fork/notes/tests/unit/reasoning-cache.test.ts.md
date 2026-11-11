# tests/unit/reasoning-cache.test.ts

kind: D · status: claimed · reason: Use DeepSeek-issued call_00_ tool-call ids in the fixture that tests the DeepSeek-issued path, since foreign ids now get the presence placeholder.

## 改动

DeepSeek 空 reasoning_content 回放用例的工具调用 id 由 `call_empty_rc` 改为 `call_00_empty_rc`（tool_call_id 同步），断言不变。

## 原因

该用例测的是 DeepSeek 自己签发的轮次；旧 id 不符合 DeepSeek 格式，在 fork 逻辑下会被当作外部调用而补占位。

## 重做

保留 `call_00_` 前缀的 id。若撤销 translator/index.ts 的 seam，本条一并撤销。

聚焦回归：

```bash
node --import tsx/esm --test --test-force-exit tests/unit/deepseek-foreign-toolcall-reasoning-presence.test.ts tests/unit/reasoning-cache.test.ts tests/unit/tool-request-sanitization.test.ts
```
